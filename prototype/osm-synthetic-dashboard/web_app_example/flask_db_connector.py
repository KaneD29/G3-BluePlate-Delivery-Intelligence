"""BluePlate V8 integration API for the local Flask/MySQL project.

This adds backend contracts but DOES NOT automatically wire the V8 browser demo
or replace the team's separately deployed Next.js/data-service architecture.
Manager writes use an explicit development-only bearer token; implement real
per-user authentication and centralized rate limits before any public release.
"""
import hmac
import os
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from uuid import UUID

import mysql.connector
from flask import Flask, Response, jsonify, request, send_from_directory

from etl.config import database_config
from web_app_example.api_helpers import (
    ACTION_CATEGORY_MAP, CATEGORY_NAME_MAP, MANILA, STATUSES,
    ValidationError, classify, combined_health, normalize_json,
    parse_period, positive_integer, safe_csv,
)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = Path(os.getenv("FRONTEND_DIR", str(PROJECT_ROOT / "frontend"))).resolve()


@contextmanager
def connection():
    db = mysql.connector.connect(**database_config("APP_DB"))
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def fetch_all(db, sql, params=()):
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(sql, tuple(params))
        return cursor.fetchall()
    finally:
        cursor.close()


def execute(db, sql, params=()):
    cursor = db.cursor()
    try:
        cursor.execute(sql, tuple(params))
        return cursor.lastrowid, cursor.rowcount
    finally:
        cursor.close()


def db_thresholds(db):
    rows = fetch_all(db, """SELECT metric_code, warning_limit, critical_limit
          FROM dim_alert_threshold WHERE is_active=1""")
    return {r["metric_code"]: r for r in rows}


def demo_manager_user(db):
    """Fail closed: demo bearer tokens are disabled entirely in production."""
    if os.getenv("BLUEPLATE_ENV", "development").lower() == "production":
        return None
    if os.getenv("ENABLE_DEMO_MANAGER_TOKEN", "false").lower() != "true":
        return None
    expected = os.getenv("MANAGER_API_TOKEN", "")
    auth = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if len(expected) < 24 or not auth.startswith(prefix):
        return None
    if not hmac.compare_digest(auth[len(prefix):], expected):
        return None
    user_raw = os.getenv("MANAGER_USER_ID", "")
    try:
        user_id = positive_integer(user_raw, "MANAGER_USER_ID")
    except ValidationError:
        return None
    rows = fetch_all(db, """SELECT user_id FROM app_users WHERE user_id=%s
            AND is_active=1 AND role IN ('ADMIN','BI_MANAGER','OPERATIONS_ANALYST')""", (user_id,))
    return rows[0]["user_id"] if rows else None


def require_manager(db):
    user = demo_manager_user(db)
    if user is None:
        raise PermissionError("Manager access is not configured or authorized")
    return user


def payload_json():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("Provide a JSON object with Content-Type: application/json")
    return data


def period_restaurants(db, period):
    params = (
        period["start_key"], period["end_key"],
        period["start_datetime"], period["end_exclusive"],
    )
    sql = """
        SELECT r.restaurant_key, r.external_place_id, r.restaurant_name, r.branch_label,
               r.distance_to_ust_km, r.price_level, r.operational_status,
               r.street_address, r.zone_key, z.zone_name, c.cuisine_name,
               f.public_avg_rating, f.modeled_demand,
               f.proxy_delivery_mins, f.cancellation_risk_index,
               f.avg_menu_price_php, f.days_observed,
               ur.auditor_report_count, ur.auditor_avg_rating,
               ur.observed_delivery_mins
        FROM dim_restaurant r
        JOIN dim_zone z ON z.zone_key=r.zone_key
        JOIN dim_cuisine c ON c.cuisine_key=r.primary_cuisine_key
        LEFT JOIN (
            SELECT restaurant_key, COUNT(*) AS days_observed,
                   ROUND(AVG(CASE WHEN total_review_count > 0 THEN public_avg_rating END), 2) AS public_avg_rating,
                   SUM(modeled_demand) AS modeled_demand,
                   ROUND(AVG(proxy_delivery_mins), 2) AS proxy_delivery_mins,
                   ROUND(AVG(cancellation_risk_index), 2) AS cancellation_risk_index,
                   ROUND(AVG(NULLIF(avg_menu_price_php, 0)), 2) AS avg_menu_price_php
            FROM vw_v8_restaurant_daily_signals
            WHERE date_key BETWEEN %s AND %s GROUP BY restaurant_key
        ) f ON f.restaurant_key=r.restaurant_key
        LEFT JOIN (
            SELECT restaurant_key, COUNT(*) AS auditor_report_count,
                   ROUND(AVG(rating_score), 2) AS auditor_avg_rating,
                   ROUND(AVG(CASE WHEN order_was_cancelled = 0
                                  THEN actual_observed_delivery_mins END), 2) AS observed_delivery_mins
            FROM app_user_reviews
            WHERE submitted_at >= %s AND submitted_at < %s
            GROUP BY restaurant_key
        ) ur ON ur.restaurant_key=r.restaurant_key
        WHERE r.operational_status = 'OPERATIONAL'
        ORDER BY r.restaurant_name, r.restaurant_key
    """
    rows = fetch_all(db, sql, params)
    thresholds = db_thresholds(db)
    for row in rows:
        public = row["public_avg_rating"]
        auditor = row["auditor_avg_rating"]
        if public is not None and auditor is not None:
            row["blended_rating"] = round(0.65 * float(public) + 0.35 * float(auditor), 2)
        elif public is not None:
            row["blended_rating"] = float(public)
        elif auditor is not None:
            row["blended_rating"] = float(auditor)
        else:
            row["blended_rating"] = None
        rating_row = {**row, "public_avg_rating": row["blended_rating"]}
        row["overall_health_status"] = combined_health(rating_row, thresholds)
        row["auditor_report_count"] = row["auditor_report_count"] or 0
        row["data_origin"] = "warehouse: modeled metrics / self-reported user observations"
        row["has_history"] = row["days_observed"] is not None
        row["metric_availability"] = {
            "delivery": row["proxy_delivery_mins"] is not None,
            "risk": row["cancellation_risk_index"] is not None,
            "rating": row["blended_rating"] is not None,
        }
    return rows


def validate_action(data, existing=None):
    """Resolve optional action fields. API stores category codes, UI displays labels."""
    text = data.get("text", data.get("note_text", (existing or {}).get("note_text", "")))
    if not isinstance(text, str) or not (3 <= len(text.strip()) <= 600):
        raise ValidationError("text must be 3–600 characters")
    label = data.get("category", (existing or {}).get("category", "GENERAL_OBSERVATION"))
    if not isinstance(label, str):
        raise ValidationError("category must be text")
    category = ACTION_CATEGORY_MAP.get(label, label)
    if category not in CATEGORY_NAME_MAP:
        raise ValidationError("Unsupported action category")
    status = data.get("status", (existing or {}).get("action_status", "OPEN"))
    if not isinstance(status, str) or status not in STATUSES:
        raise ValidationError("status must be OPEN, IN_PROGRESS, or RESOLVED")
    restaurant = data.get("restaurant_key", (existing or {}).get("restaurant_key"))
    zone = data.get("zone_key", (existing or {}).get("zone_key"))
    alert_id = data.get("alert_id", (existing or {}).get("alert_id"))
    return {
        "text": text.strip(), "category": category, "status": status,
        "restaurant_key": positive_integer(restaurant, "restaurant_key") if restaurant is not None else None,
        "zone_key": positive_integer(zone, "zone_key") if zone is not None else None,
        "alert_id": positive_integer(alert_id, "alert_id") if alert_id is not None else None,
    }


def validate_action_refs(db, action):
    if action["restaurant_key"] is not None:
        row = fetch_all(db, "SELECT zone_key FROM dim_restaurant WHERE restaurant_key=%s",
                        (action["restaurant_key"],))
        if not row:
            raise ValidationError("Unknown restaurant_key")
        restaurant_zone = row[0]["zone_key"]
        if action["zone_key"] is not None and action["zone_key"] != restaurant_zone:
            raise ValidationError("Restaurant and zone mismatch")
        action["zone_key"] = restaurant_zone
    if action["zone_key"] is None:
        raise ValidationError("A zone_key is required for zone-wide actions")
    if not fetch_all(db, "SELECT zone_key FROM dim_zone WHERE zone_key=%s", (action["zone_key"],)):
        raise ValidationError("Unknown zone_key")
    if action["alert_id"] is not None:
        records = fetch_all(db, "SELECT restaurant_key, zone_key FROM fact_alert_events WHERE alert_id=%s",
                            (action["alert_id"],))
        if not records:
            raise ValidationError("Unknown alert_id; modeled front-end alert references are not real DB alert IDs")
        alert = records[0]
        if alert["zone_key"] != action["zone_key"]:
            raise ValidationError("Alert and action zone mismatch")
        if action["restaurant_key"] is not None and alert["restaurant_key"] != action["restaurant_key"]:
            raise ValidationError("Alert and action restaurant mismatch")


@app.errorhandler(ValidationError)
def invalid(exc):
    return jsonify({"status": "error", "message": str(exc)}), 400


@app.errorhandler(PermissionError)
def forbidden(exc):
    return jsonify({"status": "error", "message": "Manager authentication required"}), 403


@app.errorhandler(mysql.connector.IntegrityError)
def conflict(exc):
    return jsonify({"status": "error", "message": "Duplicate or invalid referenced record"}), 409


@app.errorhandler(mysql.connector.Error)
def database_failure(exc):
    app.logger.exception("Database error")
    return jsonify({"status": "error", "message": "Database unavailable or schema not initialized"}), 503


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "blueplate-local-flask", "frontend_mode": "flask-local-api"})



@app.get("/api/restaurants")
def restaurants():
    q = request.args.get("q", "").strip()

    if len(q) > 100:
        raise ValidationError("Search must be at most 100 characters")

    limit = positive_integer(
        request.args.get("limit", "20"),
        "limit",
        maximum=100
    )

    offset_raw = request.args.get("offset", "0")
    offset = (
        0 if offset_raw == "0"
        else positive_integer(
            offset_raw, "offset", maximum=100000
        )
    )

    pattern = (
        "%" +
        q.replace("\\", "\\\\")
         .replace("%", "\\%")
         .replace("_", "\\_") +
        "%"
    )

    with connection() as db:
        rows = fetch_all(
            db,
            """
            SELECT
                r.restaurant_key,
                r.external_place_id,
                r.restaurant_name,
                r.branch_label,
                r.street_address,
                r.distance_to_ust_km,
                z.zone_name,
                z.zone_key,
                c.cuisine_name
            FROM dim_restaurant r
            JOIN dim_zone z
                ON z.zone_key = r.zone_key
            JOIN dim_cuisine c
                ON c.cuisine_key = r.primary_cuisine_key
            WHERE r.operational_status = 'OPERATIONAL'
              AND (
                  r.restaurant_name LIKE %s
                  OR r.street_address LIKE %s
                  OR c.cuisine_name LIKE %s
              )
            ORDER BY
                r.restaurant_name,
                r.restaurant_key
            LIMIT %s OFFSET %s
            """,
            (pattern, pattern, pattern, limit, offset)
        )

    return jsonify({
        "status": "ok",
        "restaurants": normalize_json(rows),
        "next_offset": (
            offset + limit if len(rows) == limit
            else None
        ),
        "attribution": "© OpenStreetMap contributors (ODbL)"
    })


@app.get("/api/dashboard/overview")
def overview():
    period = parse_period(request.args)
    with connection() as db:
        rows = period_restaurants(db, period)
    return jsonify({"status": "ok", "period": {"from": period["from"], "to": period["to"]},
                    "count": len(rows), "restaurants": normalize_json(rows), "data_origin": "warehouse"})


@app.get("/api/restaurants/<int:restaurant_key>")
def restaurant_detail(restaurant_key):
    period = parse_period(request.args)
    with connection() as db:
        matches = [r for r in period_restaurants(db, period) if r["restaurant_key"] == restaurant_key]
        if not matches:
            return jsonify({"status": "error", "message": "Restaurant not found"}), 404
        history = fetch_all(db, """SELECT report_date,
                    CASE WHEN total_review_count > 0 THEN public_avg_rating END AS public_avg_rating,
                    modeled_demand, proxy_delivery_mins, cancellation_risk_index,
                    CASE WHEN total_review_count > 0 THEN rating_health END AS rating_health,
                    delivery_health, cancellation_health
                    FROM vw_v8_restaurant_daily_signals
                    WHERE restaurant_key=%s AND date_key BETWEEN %s AND %s
                    ORDER BY date_key""", (restaurant_key, period["start_key"], period["end_key"]))
    return jsonify({"status": "ok", "restaurant": normalize_json(matches[0]),
                    "history": normalize_json(history), "period": {"from": period["from"], "to": period["to"]}})


@app.get("/api/dashboard/trends")

def trends():
    period = parse_period(request.args)

    with connection() as db:
        rows = fetch_all(
            db,
            """
            SELECT
                v.report_date,
                COUNT(*) AS restaurants_observed,
                SUM(v.modeled_demand) AS modeled_demand,
                ROUND(AVG(v.proxy_delivery_mins), 2) AS proxy_delivery_mins,
                ROUND(AVG(v.cancellation_risk_index), 2) AS cancellation_risk_index,
                ROUND(
                    AVG(
                        CASE
                            WHEN v.total_review_count > 0
                            THEN v.public_avg_rating
                        END
                    ), 2
                ) AS public_avg_rating
            FROM vw_v8_restaurant_daily_signals v
            JOIN dim_restaurant r
                ON r.restaurant_key = v.restaurant_key
            WHERE v.date_key BETWEEN %s AND %s
              AND r.operational_status = 'OPERATIONAL'
            GROUP BY v.report_date
            ORDER BY v.report_date
            """,
            (period["start_key"], period["end_key"])
        )

    return jsonify({
        "status": "ok",
        "period": {
            "from": period["from"],
            "to": period["to"]
        },
        "days": normalize_json(rows),
        "data_origin": "warehouse"
    })



@app.get("/api/dashboard/alerts")
def alerts():
    period = parse_period(request.args)
    severity = request.args.get("severity", "ALL")
    if severity not in {"ALL", "WARNING", "CRITICAL"}:
        raise ValidationError("severity must be ALL, WARNING, or CRITICAL")
    sql = """SELECT a.alert_id, a.restaurant_key, a.zone_key, a.created_at,
                    a.date_key, r.restaurant_name, z.zone_name, a.observed_value,
                    a.severity_level, a.alert_message, a.is_resolved,
                    COALESCE(ack.action_status,'UNACKNOWLEDGED') AS workflow_status
                FROM fact_alert_events a
                JOIN dim_restaurant r ON r.restaurant_key=a.restaurant_key
                JOIN dim_zone z ON z.zone_key=a.zone_key
                LEFT JOIN app_alert_acknowledgements ack ON ack.alert_id=a.alert_id
                WHERE a.date_key BETWEEN %s AND %s AND a.is_resolved=0"""
    params = [period["start_key"], period["end_key"]]
    if severity != "ALL":
        sql += " AND a.severity_level=%s"
        params.append(severity)
    sql += " ORDER BY FIELD(a.severity_level,'CRITICAL','WARNING'),a.created_at DESC LIMIT 500"
    with connection() as db:
        rows = fetch_all(db, sql, params)
    return jsonify({"status": "ok", "alerts": normalize_json(rows), "origin": "recorded warehouse alerts"})


@app.post("/api/user/reviews")
def submit_user_review():
    # Do not expose this unauthenticated write operation on the public internet
    # until a real anti-abuse gate and shared rate limiter are installed.
    if (os.getenv("ENABLE_GUEST_REPORTS", "false").lower() != "true"
        or os.getenv("BLUEPLATE_ENV", "development").lower() == "production"):
        return jsonify({"status": "error", "message": "Guest submissions disabled pending anti-abuse controls"}), 503
    data = payload_json()
    restaurant_key = positive_integer(data.get("restaurant_key", data.get("restaurantId")), "restaurant_key")
    rating = positive_integer(data.get("rating_score", data.get("rating")), "rating_score", maximum=5)
    cancelled = data.get("order_was_cancelled", data.get("cancelled", False))
    if not isinstance(cancelled, bool):
        raise ValidationError("order_was_cancelled must be boolean")
    minutes = data.get("actual_observed_delivery_mins", data.get("minutes"))
    if cancelled:
        if minutes is not None:
            raise ValidationError("Cancelled orders must have null delivery minutes")
    else:
        minutes = positive_integer(minutes, "actual_observed_delivery_mins", maximum=240)
    text = data.get("comment_text", data.get("notes", ""))
    if not isinstance(text, str) or not (1 <= len(text.strip()) <= 1000):
        raise ValidationError("comment_text must be 1–1000 characters")
    client_id = data.get("client_submission_id")
    if client_id is not None:
        try:
            client_id = str(UUID(str(client_id)))
        except (ValueError, TypeError, AttributeError):
            raise ValidationError("client_submission_id must be a valid UUID") from None
    with connection() as db:
        if not fetch_all(db, "SELECT restaurant_key FROM dim_restaurant WHERE restaurant_key=%s",
                         (restaurant_key,)):
            raise ValidationError("Unknown restaurant_key")
        key, _ = execute(db, """INSERT INTO app_user_reviews (
                    user_id, submission_source, restaurant_key,
                    actual_observed_delivery_mins, order_was_cancelled,
                    rating_score, comment_text, client_submission_id
                ) VALUES (NULL,'GUEST',%s,%s,%s,%s,%s,%s)""",
                (restaurant_key, minutes, cancelled, rating, text.strip(), client_id))
    return jsonify({"status": "created", "user_review_id": key,
                    "message": "Guest report stored in app_user_reviews"}), 201


@app.get("/api/manager/actions")
def manager_actions():
    status = request.args.get("status", "ALL")
    category = request.args.get("category", "ALL")
    query = request.args.get("q", "").strip()
    if status not in STATUSES | {"ALL"}:
        raise ValidationError("Invalid action status filter")
    category = ACTION_CATEGORY_MAP.get(category, category)
    if category != "ALL" and category not in CATEGORY_NAME_MAP:
        raise ValidationError("Invalid action category filter")
    if len(query) > 100:
        raise ValidationError("Action search cannot exceed 100 characters")
    sql = """SELECT a.annotation_id, a.restaurant_key, a.zone_key,
                    a.alert_id, a.target_date, a.category, a.action_status,
                    a.note_text, a.created_at, a.updated_at,
                    r.restaurant_name, z.zone_name
                FROM app_manager_annotations a
                LEFT JOIN dim_restaurant r ON r.restaurant_key=a.restaurant_key
                LEFT JOIN dim_zone z ON z.zone_key=a.zone_key
                WHERE 1=1"""
    params = []
    if status != "ALL":
        sql += " AND a.action_status=%s"
        params.append(status)
    if category != "ALL":
        sql += " AND a.category=%s"
        params.append(category)
    if query:
        pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        sql += " AND (a.note_text LIKE %s OR r.restaurant_name LIKE %s OR z.zone_name LIKE %s)"
        params.extend([pattern, pattern, pattern])
    sql += " ORDER BY a.created_at DESC LIMIT 500"
    with connection() as db:
        require_manager(db)
        rows = fetch_all(db, sql, params)
    for row in rows:
        row["category_label"] = CATEGORY_NAME_MAP.get(row["category"], row["category"])
    return jsonify({"status": "ok", "actions": normalize_json(rows)})


@app.post("/api/manager/actions")
def manager_action_create():
    data = payload_json()
    action = validate_action(data)
    with connection() as db:
        user_id = require_manager(db)
        validate_action_refs(db, action)
        key, _ = execute(db, """INSERT INTO app_manager_annotations (
                    user_id, restaurant_key, zone_key, alert_id, target_date,
                    category, action_status, note_text
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (user_id, action["restaurant_key"], action["zone_key"], action["alert_id"],
                 datetime.now(MANILA).date(), action["category"], action["status"], action["text"]))
    return jsonify({"status": "created", "annotation_id": key}), 201


@app.patch("/api/manager/actions/<int:annotation_id>")
def manager_action_edit(annotation_id):
    data = payload_json()
    with connection() as db:
        require_manager(db)
        found = fetch_all(db, """SELECT annotation_id, note_text, category,
                 action_status, restaurant_key, zone_key, alert_id
                 FROM app_manager_annotations WHERE annotation_id=%s""", (annotation_id,))
        if not found:
            return jsonify({"status": "error", "message": "Action not found"}), 404
        action = validate_action(data, found[0])
        validate_action_refs(db, action)
        execute(db, """UPDATE app_manager_annotations SET restaurant_key=%s,
                    zone_key=%s, alert_id=%s, category=%s, action_status=%s,
                    note_text=%s, updated_at=CURRENT_TIMESTAMP
                    WHERE annotation_id=%s""",
                (action["restaurant_key"], action["zone_key"], action["alert_id"],
                 action["category"], action["status"], action["text"], annotation_id))
    return jsonify({"status": "ok", "annotation_id": annotation_id})


@app.delete("/api/manager/actions/<int:annotation_id>")
def manager_action_delete(annotation_id):
    with connection() as db:
        require_manager(db)
        _, affected = execute(db, "DELETE FROM app_manager_annotations WHERE annotation_id=%s", (annotation_id,))
    if not affected:
        return jsonify({"status": "error", "message": "Action not found"}), 404
    return jsonify({"status": "deleted", "annotation_id": annotation_id})


@app.get("/api/exports/restaurants.csv")
def export_restaurants():
    period = parse_period(request.args)
    with connection() as db:
        rows = period_restaurants(db, period)
    headers = ["restaurant_key", "restaurant_name", "zone_name", "cuisine_name",
               "distance_to_ust_km", "public_avg_rating", "blended_rating", "proxy_delivery_mins",
               "cancellation_risk_index", "modeled_demand", "auditor_report_count",
               "overall_health_status", "days_observed", "data_origin"]
    output = safe_csv(rows, headers)
    return Response(output, mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=blueplate_restaurants.csv"})


@app.get("/api/exports/reports.csv")
def export_reports():
    period = parse_period(request.args)
    with connection() as db:
        require_manager(db)
        rows = fetch_all(db, """SELECT user_review_id, restaurant_key, submission_source,
                   actual_observed_delivery_mins, order_was_cancelled,
                   rating_score, comment_text, submitted_at
                FROM app_user_reviews WHERE submitted_at >= %s AND submitted_at < %s
                ORDER BY submitted_at DESC LIMIT 10000""",
                (period["start_datetime"], period["end_exclusive"]))
    headers = ["user_review_id", "restaurant_key", "submission_source",
               "actual_observed_delivery_mins", "order_was_cancelled",
               "rating_score", "comment_text", "submitted_at"]
    return Response(safe_csv(rows, headers), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=blueplate_auditor_reports.csv"})

@app.get("/api/session")
def session_info():
    """Non-sensitive capabilities only. Never return a shared manager bearer token."""
    guest_enabled = (os.getenv("BLUEPLATE_ENV", "development").lower() != "production"
                     and os.getenv("ENABLE_GUEST_REPORTS", "false").lower() == "true")
    resp = jsonify({
        "status": "ok", "mode": "live-mysql",
        "guest_reports_enabled": guest_enabled,
        "manager_actions_enabled": False,  # until server-side login/session support
        "synthetic_demo_enabled": (
            os.getenv("BLUEPLATE_ENV", "development").lower() != "production"
            and os.getenv("ENABLE_SYNTHETIC_DEMO", "false").lower() == "true"
            and request.remote_addr in {"127.0.0.1", "::1"}
        ),
    })
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/user/reviews")
def list_user_reviews():
    """Feeds the 'Recent campus reports' stream on the public portal."""
    limit = positive_integer(request.args.get("limit", "12"), "limit", maximum=50)
    with connection() as db:
        rows = fetch_all(
            db,
            """SELECT ur.user_review_id, ur.restaurant_key, r.restaurant_name,
                      z.zone_name, ur.actual_observed_delivery_mins,
                      ur.order_was_cancelled, ur.rating_score,
                      ur.comment_text, ur.submission_source, ur.submitted_at
               FROM app_user_reviews ur
               JOIN dim_restaurant r ON r.restaurant_key = ur.restaurant_key
               JOIN dim_zone z ON z.zone_key = r.zone_key
               ORDER BY ur.submitted_at DESC LIMIT %s""",
            (limit,),
        )
    return jsonify({"status": "ok", "reviews": normalize_json(rows)})


@app.patch("/api/dashboard/alerts/<int:alert_id>")
def update_alert_status(alert_id):
    """Persists Acknowledge / Resolve clicks from the Admin Alert Center."""
    data = payload_json()
    new_status = data.get("status", "")
    if new_status not in {"ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"}:
        raise ValidationError("Invalid alert action_status")
    with connection() as db:
        user_id = require_manager(db)
        found = fetch_all(db, "SELECT alert_id FROM fact_alert_events WHERE alert_id=%s", (alert_id,))
        if not found:
            return jsonify({"status": "error", "message": "Alert not found"}), 404
        execute(
            db,
            """INSERT INTO app_alert_acknowledgements (alert_id, user_id, action_status)
               VALUES (%s, %s, %s)
               ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), action_status=VALUES(action_status)""",
            (alert_id, user_id, new_status),
        )
        if new_status in {"RESOLVED", "FALSE_POSITIVE"}:
            execute(db, "UPDATE fact_alert_events SET is_resolved=1 WHERE alert_id=%s", (alert_id,))
    return jsonify({"status": "ok", "alert_id": alert_id, "workflow_status": new_status})

@app.post("/api/etl/refresh")
def trigger_etl_refresh():
    """Explicit development-only ETL maintenance endpoint; never called by public UI."""
    from etl.warehouse_loader import run_etl_pipeline
    with connection() as db:
        require_manager(db)
    summary = run_etl_pipeline()
    return jsonify({"status": "ok", "summary": summary})

@app.get("/")
def serve_public():
    if FRONTEND_ROOT.joinpath("index.html").is_file():
        return send_from_directory(FRONTEND_ROOT, "index.html")
    return jsonify({"service": "BluePlate V8 API", "hint": "Place V8 frontend/ beside etl/ to serve it here"})


@app.get("/admin/")
def serve_admin():
    if os.getenv("BLUEPLATE_ENV", "development").lower() == "production":
        return jsonify({"status": "error", "message": "Admin sign-in not implemented"}), 403
    if not FRONTEND_ROOT.joinpath("admin/index.html").is_file():
        return jsonify({"status": "error", "message": "Frontend not installed"}), 404
    return send_from_directory(FRONTEND_ROOT / "admin", "index.html")


@app.get("/assets/<path:filename>")
def serve_assets(filename):
    if not FRONTEND_ROOT.joinpath("assets").is_dir():
        return jsonify({"status": "error", "message": "Frontend not installed"}), 404
    return send_from_directory(FRONTEND_ROOT / "assets", filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("FLASK_PORT", "5000")),
            debug=os.getenv("BLUEPLATE_ENV") == "development"
                  and os.getenv("FLASK_DEBUG", "false").lower() == "true")
