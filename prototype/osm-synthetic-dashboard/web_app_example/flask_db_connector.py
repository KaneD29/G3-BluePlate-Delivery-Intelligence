"""BluePlate V8 integration API for the local Flask/MySQL project.

This adds backend contracts but DOES NOT automatically wire the V8 browser demo
or replace the team's separately deployed Next.js/data-service architecture.
Manager writes use an explicit development-only bearer token; implement real
per-user authentication and centralized rate limits before any public release.
"""
from collections import Counter
import csv
import hmac
import io
import json
import math
import os
import re
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta
from ipaddress import ip_address
from pathlib import Path
from threading import Lock
from time import monotonic
from urllib.parse import urlsplit
from uuid import UUID

import mysql.connector
from requests import RequestException
from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session
from itsdangerous import BadData, URLSafeTimedSerializer
from mysql.connector.errorcode import ER_DUP_ENTRY

from etl.config import database_config
from web_app_example.api_helpers import (
    ACTION_CATEGORY_MAP, CATEGORY_NAME_MAP, MANILA, STATUSES,
    ValidationError, classify, combined_health, normalize_json,
    parse_period, positive_integer, safe_csv,
)
from web_app_example.production_guest import TURNSTILE_ACTION, production_guest, verify_turnstile

app = Flask(__name__)
app.config.update(
    MAX_CONTENT_LENGTH=16 * 1024,
    SECRET_KEY=os.getenv("BLUEPLATE_GUEST_SESSION_SECRET"),
    SESSION_COOKIE_NAME="blueplate_guest_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.getenv("BLUEPLATE_ENV", "").lower() == "production",
    SESSION_COOKIE_SAMESITE="Strict",
)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = Path(os.getenv("FRONTEND_DIR", str(PROJECT_ROOT / "frontend"))).resolve()


GUEST_WINDOW_SECONDS = 60
GUEST_SESSION_LIMIT = 5
GUEST_PEER_LIMIT = 15
GUEST_LIMIT_CAPACITY = 256
GUEST_TOKEN_SECONDS = 15 * 60
_guest_lock = Lock()
_guest_counts = {}
_guest_window_end = 0


def loopback_peer():
    try:
        address = ip_address(request.remote_addr)
    except ValueError:
        return None
    address = getattr(address, "ipv4_mapped", None) or address
    return str(address) if address.is_loopback else None


def guest_request():
    """Share the capability and POST gate, including the effective origin and peer."""
    secret = app.secret_key or ""
    if len(secret.strip()) < 32 or os.getenv("ENABLE_SYNTHETIC_DEMO", "false").lower() == "true":
        return None
    mode = os.getenv("BLUEPLATE_ENV", "").lower()
    if mode == "production":
        settings = production_guest(request)
        if (settings and app.config["SESSION_COOKIE_SECURE"] is True
                and app.config["SESSION_COOKIE_HTTPONLY"] is True
                and app.config["SESSION_COOKIE_SAMESITE"] == "Strict"
                and app.config["SESSION_COOKIE_DOMAIN"] is None):
            return settings.origin, settings.peer, settings
    elif mode == "development" and os.getenv("ENABLE_GUEST_REPORTS", "false").lower() == "true":
        peer = loopback_peer()
        if peer and urlsplit(request.host_url).hostname in {"localhost", "127.0.0.1", "::1"}:
            return request.host_url.rstrip("/"), peer, None
    return None


def guest_token_serializer():
    return URLSafeTimedSerializer(app.secret_key, salt="blueplate-guest-report-form")


def guest_retry_after(peer, visitor):
    """Bound request counts and memory within a fixed, process-local window."""
    global _guest_window_end
    keys = [("peer", peer, GUEST_PEER_LIMIT)]
    if visitor:
        keys.append(("session", visitor, GUEST_SESSION_LIMIT))
    with _guest_lock:
        now = monotonic()
        if now >= _guest_window_end:
            _guest_counts.clear()
            _guest_window_end = now + GUEST_WINDOW_SECONDS
        new_keys = sum((scope, value) not in _guest_counts for scope, value, _ in keys)
        if len(_guest_counts) + new_keys > GUEST_LIMIT_CAPACITY or any(
            _guest_counts.get((scope, value), 0) >= limit for scope, value, limit in keys
        ):
            return max(1, math.ceil(_guest_window_end - now))
        for scope, value, _ in keys:
            key = (scope, value)
            _guest_counts[key] = _guest_counts.get(key, 0) + 1
    return None


@contextmanager
def connection():
    db = mysql.connector.connect(**database_config("APP_DB"))
    try:
        # MySQL TIMESTAMP comparisons and reads use Manila calendar time.
        db.time_zone = "+08:00"
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


REPORT_AGGREGATES = """
    COUNT(*) AS auditor_report_count,
    COUNT(CASE WHEN rating_score BETWEEN 1 AND 5 THEN 1 END) AS report_rating_count,
    ROUND(AVG(CASE WHEN rating_score BETWEEN 1 AND 5 THEN rating_score END), 2) AS auditor_avg_rating,
    COUNT(CASE WHEN order_was_cancelled = 0 AND actual_observed_delivery_mins BETWEEN 1 AND 240
               THEN 1 END) AS completed_delivery_count,
    ROUND(AVG(CASE WHEN order_was_cancelled = 0 AND actual_observed_delivery_mins BETWEEN 1 AND 240
                   THEN actual_observed_delivery_mins END), 2) AS observed_delivery_mins,
    COUNT(CASE WHEN order_was_cancelled = 1 THEN 1 END) AS cancelled_report_count,
    COUNT(CASE WHEN order_was_cancelled IN (0, 1) THEN 1 END) AS known_outcome_count
"""
REPORT_COUNTS = ("auditor_report_count", "report_rating_count", "completed_delivery_count",
                 "cancelled_report_count", "known_outcome_count")


def summarize_report_counts(row):
    for key in REPORT_COUNTS:
        row[key] = row[key] or 0
    known = row["known_outcome_count"]
    row["reported_cancellation_share"] = row["cancelled_report_count"] / known if known else None


def report_totals(db, period):
    totals, = fetch_all(db, f"""
        SELECT {REPORT_AGGREGATES} FROM app_user_reviews
        WHERE submitted_at >= %s AND submitted_at < %s
    """, (period["start_datetime"], period["end_exclusive"]))
    summarize_report_counts(totals)
    return totals


def expanded_directory():
    return os.getenv("BLUEPLATE_EXPANDED_DIRECTORY", "").lower() == "true"


def pilot_visible():
    return os.getenv("BLUEPLATE_SHOW_DIRECTORY_ADDITIONS", "").lower() == "true"


# Only constants are interpolated into SQL; request data remains bound.
DIRECTORY_STATUS = """r.publication_status='APPROVED' AND r.withdrawn_at IS NULL
    AND r.identity_hold=FALSE AND (
        (r.bi_scope='LEGACY' AND r.operational_status='OPERATIONAL') OR
        (r.bi_scope='DIRECTORY_ONLY' AND (
          (r.directory_provenance IN ('USER_CONFIRMED','INDEPENDENTLY_VERIFIED')
            AND r.operational_status='OPERATIONAL') OR
          (r.directory_provenance='OSM_LISTED' AND r.operational_status='UNKNOWN')
        ))
    )"""


def revised_directory():
    return (expanded_directory()
            and os.getenv("BLUEPLATE_REVISED_DIRECTORY", "").lower() == "true")


def directory_relation():
    return "revised_directory" if revised_directory() else "dim_restaurant"


def directory_predicate():
    if revised_directory():
        return ("r.public_visible=TRUE AND r.withdrawn_at IS NULL"
                + ("" if pilot_visible() else " AND r.bi_scope='LEGACY'"))
    if not expanded_directory():
        return "r.operational_status = 'OPERATIONAL'"
    return DIRECTORY_STATUS + ("" if pilot_visible() else " AND r.bi_scope='LEGACY'")


DIRECTORY_FIELDS = """r.operational_status, r.directory_provenance AS verification_provenance,
    r.confirmed_on, r.osm_opening_hours, r.guest_reporting_enabled AS guest_reporting_eligible"""


def versioned_bi_enabled():
    return os.getenv("BLUEPLATE_VERSIONED_BI", "").lower() == "true"


def reviewed_cuisine_sql():
    """Return the current-directory display dimension without altering legacy cuisine keys."""
    if revised_directory():
        name = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(cr.review_evidence,'$.cuisine_classification.label')),NULLIF(c.cuisine_name,'Unclassified / Pending Review'))"
        join = "LEFT JOIN revised_directory_review cr ON cr.restaurant_key=r.restaurant_key"
        extra = ", JSON_EXTRACT(cr.review_evidence,'$.cuisine_classification') AS cuisine_classification"
        return name, join, extra
    return ("NULLIF(c.cuisine_name,'Unclassified / Pending Review')" if expanded_directory() else "c.cuisine_name"), "", ""


def parse_cuisine_annotation(rows):
    for row in rows:
        if row.get("cuisine_classification") is not None:
            row["cuisine_classification"] = json.loads(row["cuisine_classification"])


def current_cuisine_annotations(db):
    return {row["external_place_id"]:json.loads(row["classification"]) for row in fetch_all(db, """
        SELECT d.external_place_id, JSON_EXTRACT(r.review_evidence,'$.cuisine_classification') AS classification
        FROM revised_directory_review r JOIN dim_restaurant d USING(restaurant_key)
        WHERE r.public_visible AND JSON_CONTAINS_PATH(r.review_evidence,'one','$.cuisine_classification')
    """)}


def legacy_signal_source():
    if versioned_bi_enabled():
        return "(SELECT * FROM vw_bi_modeled_restaurant_day WHERE model_version='legacy-osm-daily-v1') v"
    return "vw_v8_restaurant_daily_signals v"


def period_restaurants(db, period):
    params = (
        period["start_key"], period["end_key"],
        period["start_datetime"], period["end_exclusive"],
    )
    sql = f"""
        SELECT r.restaurant_key, r.external_place_id, r.restaurant_name, r.branch_label,
               r.distance_to_ust_km, r.price_level, r.operational_status,
               r.street_address, r.zone_key, z.zone_name, c.cuisine_name,
               f.public_avg_rating, f.warehouse_rating_days, f.modeled_demand,
               f.proxy_delivery_mins, f.cancellation_risk_index,
               f.avg_menu_price_php, f.days_observed,
               ur.auditor_report_count, ur.auditor_avg_rating, ur.report_rating_count,
               ur.observed_delivery_mins, ur.completed_delivery_count,
               ur.cancelled_report_count, ur.known_outcome_count
        FROM dim_restaurant r
        JOIN dim_zone z ON z.zone_key=r.zone_key
        JOIN dim_cuisine c ON c.cuisine_key=r.primary_cuisine_key
        LEFT JOIN (
            SELECT restaurant_key, COUNT(*) AS days_observed,
                   ROUND(AVG(CASE WHEN total_review_count > 0 AND public_avg_rating BETWEEN 1 AND 5 THEN public_avg_rating END), 2) AS public_avg_rating,
                   COUNT(CASE WHEN total_review_count > 0 AND public_avg_rating BETWEEN 1 AND 5 THEN public_avg_rating END) AS warehouse_rating_days,
                   SUM(modeled_demand) AS modeled_demand,
                   ROUND(AVG(proxy_delivery_mins), 2) AS proxy_delivery_mins,
                   ROUND(AVG(cancellation_risk_index), 2) AS cancellation_risk_index,
                   ROUND(AVG(NULLIF(avg_menu_price_php, 0)), 2) AS avg_menu_price_php
            FROM {legacy_signal_source()}
            WHERE date_key BETWEEN %s AND %s GROUP BY restaurant_key
        ) f ON f.restaurant_key=r.restaurant_key
        LEFT JOIN (
            SELECT restaurant_key, {REPORT_AGGREGATES}
            FROM app_user_reviews
            WHERE submitted_at >= %s AND submitted_at < %s
            GROUP BY restaurant_key
        ) ur ON ur.restaurant_key=r.restaurant_key
        WHERE r.operational_status = 'OPERATIONAL'
        {"AND r.bi_scope='LEGACY'" if expanded_directory() else ""}
        ORDER BY r.restaurant_name, r.restaurant_key
    """
    rows = fetch_all(db, sql, params)
    thresholds = db_thresholds(db)
    for row in rows:
        row["warehouse_rating_days"] = row["warehouse_rating_days"] or 0
        row["overall_health_status"] = combined_health(row, thresholds)
        summarize_report_counts(row)
        row["data_origin"] = "warehouse: modeled metrics / self-reported user observations"
        row["has_history"] = row["days_observed"] is not None
        row["metric_availability"] = {
            "delivery": row["proxy_delivery_mins"] is not None,
            "risk": row["cancellation_risk_index"] is not None,
            "rating": row["public_avg_rating"] is not None,
            "self_reported_rating": row["auditor_avg_rating"] is not None,
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
    if os.getenv("BLUEPLATE_ENV", "").lower() == "production":
        app.logger.error("Database request failed (MySQL errno %s)", exc.errno)
    else:
        app.logger.exception("Database error")
    return jsonify({"status": "error", "message": "Database unavailable or schema not initialized"}), 503


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "service": "blueplate-local-flask", "frontend_mode": "flask-local-api"})



@app.get("/api/ready")
def readiness():
    """Probe permissions and metadata without reading report rows or writing data."""
    try:
        with mysql.connector.connect(**database_config("APP_DB")) as db:
            for query in (
                "SELECT restaurant_key, external_place_id, restaurant_name, branch_label, distance_to_ust_km, "
                "price_level, street_address, zone_key, primary_cuisine_key, operational_status "
                "FROM dim_restaurant LIMIT 0",
                "SELECT zone_key, zone_name FROM dim_zone LIMIT 0",
                "SELECT cuisine_key, cuisine_name FROM dim_cuisine LIMIT 0",
                "SELECT metric_code, warning_limit, critical_limit FROM dim_alert_threshold LIMIT 0",
                "SELECT user_review_id, user_id, restaurant_key, actual_observed_delivery_mins, "
                "order_was_cancelled, rating_score, comment_text, submission_source, "
                "client_submission_id, submitted_at FROM app_user_reviews LIMIT 0",
                "SELECT date_key, report_date, restaurant_key, total_review_count, public_avg_rating, "
                "modeled_demand, proxy_delivery_mins, cancellation_risk_index, "
                "avg_menu_price_php, rating_health, delivery_health, cancellation_health "
                "FROM vw_v8_restaurant_daily_signals LIMIT 0",
                "SELECT alert_id, date_key, zone_key, restaurant_key, observed_value, "
                "severity_level, alert_message, is_resolved, created_at FROM fact_alert_events LIMIT 0",
                "SELECT alert_id, action_status FROM app_alert_acknowledgements LIMIT 0",
            ):
                fetch_all(db, query)
            indexes = fetch_all(db, """
                SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique,
                       SEQ_IN_INDEX AS position, COLUMN_NAME AS column_name, SUB_PART AS sub_part
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_user_reviews'
                  AND INDEX_NAME IN ('uk_review_client_submission', 'idx_user_review_time')
            """)
            ready = {(r["index_name"], r["non_unique"], r["position"], r["column_name"], r["sub_part"])
                     for r in indexes} == {
                ("uk_review_client_submission", 0, 1, "client_submission_id", None),
                ("idx_user_review_time", 1, 1, "submitted_at", None),
                ("idx_user_review_time", 1, 2, "restaurant_key", None),
            }
    except (mysql.connector.Error, ValueError):
        ready = False
    return (jsonify({"status": "ready" if ready else "unavailable"}), 200 if ready else 503,
            {"Cache-Control": "no-store"})


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

    extra = f", {DIRECTORY_FIELDS}" if expanded_directory() else ""
    address = "NULLIF(r.street_address,'')" if expanded_directory() else "r.street_address"
    cuisine, cuisine_join, cuisine_extra = reviewed_cuisine_sql()
    with connection() as db:
        rows = fetch_all(
            db,
            f"""
            SELECT
                r.restaurant_key,
                r.external_place_id,
                r.restaurant_name,
                r.branch_label,
                {address} AS street_address,
                r.distance_to_ust_km,
                z.zone_name,
                z.zone_key,
                {cuisine} AS cuisine_name
                {extra}{cuisine_extra}
            FROM {directory_relation()} r
            JOIN dim_zone z
                ON z.zone_key = r.zone_key
            JOIN dim_cuisine c
                ON c.cuisine_key = r.primary_cuisine_key
            {cuisine_join}
            WHERE {directory_predicate()}
              AND (
                  r.restaurant_name LIKE %s
                  OR r.street_address LIKE %s
                  OR {cuisine} LIKE %s
              )
            ORDER BY
                r.restaurant_name,
                r.restaurant_key
            LIMIT %s OFFSET %s
            """,
            (pattern, pattern, pattern, limit, offset)
        )

    parse_cuisine_annotation(rows)
    return jsonify({
        "status": "ok",
        "restaurants": normalize_json(rows),
        "next_offset": (
            offset + limit if len(rows) == limit
            else None
        ),
        "attribution": "© OpenStreetMap contributors (ODbL)"
    })


@app.get("/api/dashboard/coverage")
def reporting_coverage():
    today = datetime.now(MANILA).date()
    with connection() as db:
        cohort = "AND r.bi_scope='LEGACY'" if expanded_directory() else ""
        rows = fetch_all(db, f"""
            SELECT (
                SELECT MAX(v.report_date)
                FROM {legacy_signal_source()}
                JOIN dim_restaurant r ON r.restaurant_key = v.restaurant_key
                WHERE r.operational_status = 'OPERATIONAL' {cohort} AND v.report_date <= %s
            ) AS latest_reporting_date, (
                SELECT DATE(MAX(submitted_at)) FROM app_user_reviews WHERE submitted_at < %s
            ) AS latest_report_submission_date
        """, (today, today + timedelta(days=1)))
    return jsonify({"status": "ok", **normalize_json(rows[0]), "data_origin": "warehouse"})


@app.get("/api/dashboard/directory-coverage")
def directory_coverage():
    if not expanded_directory():
        return jsonify({"status":"error","message":"Expanded directory disabled"}), 404
    period = parse_period(request.args)
    with connection() as db:
        stats, = fetch_all(db, f"""SELECT
            (SELECT COUNT(*) FROM {directory_relation()} r WHERE {directory_predicate()}) AS public_listings,
            (SELECT COUNT(DISTINCT v.restaurant_key) FROM {legacy_signal_source()}
             JOIN dim_restaurant r USING(restaurant_key)
             WHERE r.bi_scope='LEGACY' AND r.operational_status='OPERATIONAL'
             AND v.date_key BETWEEN %s AND %s) AS modeled_venues,
            (SELECT COUNT(DISTINCT restaurant_key) FROM app_user_reviews
             WHERE submission_source='GUEST' AND submitted_at >= %s AND submitted_at < %s)
             AS guest_self_reported_venues""",
            (period["start_key"],period["end_key"],period["start_datetime"],period["end_exclusive"]))
    return jsonify({"status":"ok", **normalize_json(stats)})


@app.get("/api/dashboard/overview")
def overview():
    period = parse_period(request.args)
    with connection() as db:
        rows = period_restaurants(db, period)
        totals = report_totals(db, period)
    return jsonify({"status": "ok", "report_totals": normalize_json(totals), "period": {"from": period["from"], "to": period["to"]},
                    "count": len(rows), "restaurants": normalize_json(rows), "data_origin": "warehouse"})


@app.get("/api/restaurants/<int:restaurant_key>")
def restaurant_detail(restaurant_key):
    period = parse_period(request.args)
    with connection() as db:
        matches = [r for r in period_restaurants(db, period) if r["restaurant_key"] == restaurant_key]
        if expanded_directory():
            cuisine, cuisine_join, cuisine_extra = reviewed_cuisine_sql()
            details = fetch_all(db, f"""SELECT r.restaurant_key, r.external_place_id,
                    r.restaurant_name, r.branch_label, r.distance_to_ust_km,
                    NULLIF(r.street_address,'') AS street_address,
                    {cuisine} AS cuisine_name,
                    z.zone_name, {DIRECTORY_FIELDS}{cuisine_extra}
                FROM {directory_relation()} r JOIN dim_zone z USING(zone_key)
                JOIN dim_cuisine c ON c.cuisine_key=r.primary_cuisine_key
                {cuisine_join}
                WHERE r.restaurant_key=%s AND ({directory_predicate()})""", (restaurant_key,))
            parse_cuisine_annotation(details)
            if not details:
                return jsonify({"status": "error", "message": "Restaurant not found"}), 404
            if matches:
                matches[0].update(details[0])
            else:
                recent, = fetch_all(db, f"""SELECT {REPORT_AGGREGATES} FROM app_user_reviews
                    WHERE restaurant_key=%s AND submitted_at >= %s AND submitted_at < %s""",
                    (restaurant_key, period["start_datetime"], period["end_exclusive"]))
                summarize_report_counts(recent)
                return jsonify({"status":"ok", "restaurant":normalize_json({**details[0], **recent}),
                                "history":[], "period":{"from":period["from"],"to":period["to"]}})
        if not matches:
            return jsonify({"status": "error", "message": "Restaurant not found"}), 404
        history = fetch_all(db, f"""SELECT report_date,
                    CASE WHEN total_review_count > 0 AND public_avg_rating BETWEEN 1 AND 5 THEN public_avg_rating END AS public_avg_rating,
                    modeled_demand, proxy_delivery_mins, cancellation_risk_index,
                    CASE WHEN total_review_count > 0 AND public_avg_rating BETWEEN 1 AND 5 THEN rating_health END AS rating_health,
                    delivery_health, cancellation_health
                    FROM {legacy_signal_source()}
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
            f"""
            SELECT
                v.report_date,
                COUNT(*) AS restaurants_observed,
                SUM(v.modeled_demand) AS modeled_demand,
                ROUND(AVG(v.proxy_delivery_mins), 2) AS proxy_delivery_mins,
                ROUND(AVG(v.cancellation_risk_index), 2) AS cancellation_risk_index,
                ROUND(
                    AVG(
                        CASE
                            WHEN v.total_review_count > 0 AND v.public_avg_rating BETWEEN 1 AND 5
                            THEN v.public_avg_rating
                        END
                    ), 2
                ) AS public_avg_rating
            FROM {legacy_signal_source()}
            JOIN dim_restaurant r
                ON r.restaurant_key = v.restaurant_key
            WHERE v.date_key BETWEEN %s AND %s
              AND r.operational_status = 'OPERATIONAL'
              {"AND r.bi_scope='LEGACY'" if expanded_directory() else ""}
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
    eligibility = guest_request()
    if not eligibility:
        return jsonify({"status": "error", "message": "Guest submissions are disabled"}), 503
    origin, peer, challenge = eligibility
    visitor = session.get("guest_visitor")
    retry_after = guest_retry_after(peer, visitor)
    if retry_after is not None:
        return (jsonify({"status": "error", "message": "Too many report attempts"}), 429,
                {"Retry-After": str(retry_after)})
    if request.headers.get("Origin") != origin:
        return jsonify({"status": "error", "message": "Same-origin request required"}), 403
    try:
        token_visitor = guest_token_serializer().loads(
            request.headers.get("X-BluePlate-Form-Token", ""), max_age=GUEST_TOKEN_SECONDS
        )
    except BadData:
        token_visitor = None
    if not visitor or token_visitor != visitor:
        return jsonify({"status": "error", "message": "Missing or expired guest form token"}), 403
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
    try:
        client_id = str(UUID(str(data["client_submission_id"])))
    except (KeyError, ValueError, TypeError, AttributeError):
        raise ValidationError("client_submission_id must be a valid UUID") from None

    if challenge:
        try:
            verified = verify_turnstile(challenge, data.get("challenge_response"))
        except (RequestException, ValueError):
            return jsonify({"status": "error", "message": "Report verification temporarily unavailable"}), 503
        if not verified:
            return jsonify({"status": "error", "message": "Complete a new report verification challenge"}), 403

    report = (restaurant_key, minutes, cancelled, rating, text.strip())
    try:
        with connection() as db:
            gate = (f"({directory_predicate()}) AND r.guest_reporting_enabled=TRUE"
                    if expanded_directory() else "operational_status='OPERATIONAL'")
            key, inserted = execute(db, f"""INSERT INTO app_user_reviews (
                        user_id, submission_source, restaurant_key,
                        actual_observed_delivery_mins, order_was_cancelled,
                        rating_score, comment_text, client_submission_id
                    ) SELECT NULL,'GUEST',restaurant_key,%s,%s,%s,%s,%s
                    FROM {directory_relation()} r
                    WHERE restaurant_key=%s AND {gate}""",
                    (*report[1:], client_id, restaurant_key))
    except mysql.connector.IntegrityError as error:
        if error.errno != ER_DUP_ENTRY:
            raise
        # Read after rollback, in a fresh transaction, to see the committed winner.
        return guest_report_replay(client_id, report)
    if not inserted:
        # An accepted report remains replayable if its venue subsequently closed.
        return guest_report_replay(client_id, report)
    return jsonify({"status": "created", "user_review_id": key,
                    "message": "Guest report stored in app_user_reviews"}), 201


def guest_report_replay(client_id, report):
    with connection() as db:
        rows = fetch_all(db, """SELECT user_review_id, submission_source, restaurant_key,
                    actual_observed_delivery_mins, order_was_cancelled, rating_score, comment_text
                FROM app_user_reviews WHERE client_submission_id=%s""", (client_id,))
    if not rows:
        raise ValidationError("Unknown or inactive restaurant_key")
    row = rows[0]
    stored = (row["restaurant_key"], row["actual_observed_delivery_mins"],
              row["order_was_cancelled"], row["rating_score"], row["comment_text"])
    if row["submission_source"] != "GUEST" or stored != report:
        return jsonify({"status": "error", "message": "Submission UUID already used for another report"}), 409
    return jsonify({"status": "replayed", "user_review_id": row["user_review_id"]})


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
               "distance_to_ust_km", "public_avg_rating", "warehouse_rating_days", "proxy_delivery_mins",
               "cancellation_risk_index", "modeled_demand", "auditor_avg_rating", "observed_delivery_mins",
               *REPORT_COUNTS, "reported_cancellation_share", "overall_health_status", "days_observed", "data_origin"]
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
    eligibility = guest_request()
    capabilities = {
        "status": "ok", "mode": "live-mysql",
        "guest_reports_enabled": eligibility is not None,
        "manager_actions_enabled": False,  # until server-side login/session support
        "synthetic_demo_enabled": (
            os.getenv("BLUEPLATE_ENV", "development").lower() != "production"
            and os.getenv("ENABLE_SYNTHETIC_DEMO", "false").lower() == "true"
            and request.remote_addr in {"127.0.0.1", "::1"}
        ),
    }
    if versioned_bi_enabled():
        capabilities["versioned_bi"] = True
    if current_bi_enabled():
        capabilities["current_bi_model"] = CURRENT_BI_MODEL
    if expanded_directory():
        capabilities["expanded_directory"] = True
    if eligibility:
        if "guest_visitor" not in session:
            session["guest_visitor"] = secrets.token_urlsafe(24)
        capabilities["guest_form_token"] = guest_token_serializer().dumps(session["guest_visitor"])
        if eligibility[2]:
            capabilities["guest_challenge"] = {
                "site_key": eligibility[2].site_key, "action": TURNSTILE_ACTION,
            }
    resp = jsonify(capabilities)
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
                      ur.submission_source, ur.submitted_at
               FROM app_user_reviews ur
               JOIN dim_restaurant r ON r.restaurant_key = ur.restaurant_key
               JOIN dim_zone z ON z.zone_key = r.zone_key
               ORDER BY ur.submitted_at DESC, ur.user_review_id DESC LIMIT %s""",
            (limit,),
        )
    for row in rows:
        row["submitted_at"] = row["submitted_at"].replace(tzinfo=MANILA)
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
    if expanded_directory():
        return jsonify({"status":"error","message":"ETL refresh disabled for expanded directory"}), 404
    from etl.warehouse_loader import run_etl_pipeline
    with connection() as db:
        require_manager(db)
    summary = run_etl_pipeline()
    return jsonify({"status": "ok", "summary": summary})

PRIVATE_ENDPOINTS = {
    "manager_actions", "manager_action_create", "manager_action_edit", "manager_action_delete",
    "export_reports", "update_alert_status", "trigger_etl_refresh",
}


@app.before_request
def block_production_management():
    if (os.getenv("BLUEPLATE_ENV", "").lower() == "production"
            and request.endpoint in PRIVATE_ENDPOINTS):
        return jsonify({"status": "error", "message": "Not found"}), 404


def serve_frontend(filename, *, live_required=False):
    path = FRONTEND_ROOT / filename
    if not path.is_file():
        return jsonify({"status": "error", "message": "Frontend not installed"}), 404
    markup = path.read_text(encoding="utf-8")
    markup = re.sub(r'data-flask-home href="[^"]+"', 'data-flask-home href="/"', markup)
    markup = re.sub(r'data-flask-dashboard href="[^"#]+([^"]*)"',
                    r'data-flask-dashboard href="/dashboard/\1"', markup)
    if not live_required:
        return Response(markup, mimetype="text/html", headers={"Cache-Control": "no-store"})
    markup = markup.replace("<body ", '<body data-live-required="true" ', 1)
    markup = re.sub(r'<!-- local-manager:start -->.*?<!-- local-manager:end -->', "", markup, flags=re.S)
    markup = re.sub(r'<script src="(?:\.\./)?assets/(?:sample-data|blueplate-synthetic-demo)\.js"></script>',
                    "", markup)
    if filename == "index.html":
        markup = markup.replace('class="header-chip">Public demo', 'class="header-chip">Delivery reports')
        markup = markup.replace("Four quick steps. Your report is part of this browser-only demonstration.",
                                "Reports are self-reported. Notes stay private.")
        markup = markup.replace('type="submit" class="submit-btn">Submit practice report',
                                'type="submit" class="submit-btn" disabled>Reports temporarily disabled')
        markup = markup.replace("Demo only. Reports are stored locally in your browser when permitted—not sent to a live database.",
                                "The report form opens when the live service is available.")
        markup = markup.replace("Community snapshots · demo", "Community reports")
        markup = markup.replace("A simple look at sample and locally submitted experiences.",
                                "Recent self-reported delivery experiences.")
        markup = markup.replace("Interactive prototype with sample data. Public reporting page; no account is required in demo mode.",
                                "Campus delivery reports and restaurant analytics.")
    else:
        markup = markup.replace("Admin demo", "Read-only BI dashboard")
        markup = markup.replace("Static demo unless the local Flask/MySQL API is running. No admin login is implemented.",
                                "Read-only warehouse analytics and community report summaries.")
        markup = markup.replace("Simulate refresh", "Refresh warehouse view")
    return Response(markup, mimetype="text/html", headers={"Cache-Control": "no-store"})


CURRENT_BI_MODEL = "ust-distance-scenario-v2"


def current_bi_enabled():
    return (expanded_directory() and revised_directory()
            and os.getenv("BLUEPLATE_CURRENT_BI_MODEL") == CURRENT_BI_MODEL)


def warehouse_freshness(db):
    status, = fetch_all(db, """
        SELECT (SELECT MAX(report_date) FROM vw_bi_analytical_date) AS warehouse_as_of,
               (SELECT MAX(submitted_at) FROM app_user_reviews WHERE submission_source='GUEST') AS latest_genuine_report,
               (SELECT MAX(committed_at) FROM directory_publication_batch) AS directory_updated_at
    """)
    status["analytical_dates"] = fetch_all(db, """
        SELECT a.report_date,a.model_version,a.modeled_venues,m.metric_family
        FROM vw_bi_analytical_date a JOIN dim_bi_model_version m USING(model_version)
        ORDER BY a.report_date DESC,a.model_version
    """)
    return normalize_json(status)


@app.get("/api/dashboard/freshness")
def dashboard_freshness():
    if not versioned_bi_enabled():
        return jsonify({"status":"error","message":"Warehouse freshness unavailable"}),404
    with connection() as db:
        return jsonify({"status":"ok",**warehouse_freshness(db)}),200,{"Cache-Control":"no-store"}


def scenario_publication(db):
    selected = request.args.get("date")
    if selected is not None:
        try:
            key = int(datetime.strptime(selected,"%Y-%m-%d").strftime("%Y%m%d"))
        except ValueError:
            raise ValidationError("Invalid analytical date") from None
    else:
        key = None
    return fetch_all(db, """
        SELECT p.date_key,p.model_version,p.audit_model_version,p.display_metadata,p.audited_snapshot_sha256
        FROM bi_model_publication p JOIN dim_bi_model_version m USING(model_version)
        WHERE m.metric_family='DELIVERY_SCENARIO' AND (%s IS NULL OR p.date_key=%s)
        ORDER BY p.date_key DESC,p.published_at DESC,p.model_version DESC LIMIT 1
    """,(key,key))


@app.get("/api/dashboard/student-period")
def student_dashboard_period():
    if not (versioned_bi_enabled() and current_bi_enabled()):
        return jsonify({"status":"error","message":"Reporting period unavailable"}),404
    latest = request.args.get("latest") == "1"
    period = None if latest else parse_period(request.args)
    end = (datetime.now(MANILA).date()+timedelta(days=1)) if latest else period["end_exclusive"]
    start = None if latest else period["start_datetime"]
    with connection() as db:
        selection = fetch_all(db, """
            SELECT a.report_date,a.model_version,a.modeled_venues,m.metric_family
            FROM vw_bi_analytical_date a JOIN dim_bi_model_version m USING(model_version)
            WHERE (%s IS NULL OR a.report_date >= %s) AND a.report_date < %s
            ORDER BY a.report_date DESC,(m.metric_family='DELIVERY_SCENARIO') DESC,a.model_version DESC LIMIT 1
        """,(start,start,end))
        params = (start,start,end)
        condition = "submission_source='GUEST' AND (%s IS NULL OR submitted_at >= %s) AND submitted_at < %s"
        totals, = fetch_all(db,f"""SELECT {REPORT_AGGREGATES}, COUNT(DISTINCT restaurant_key) AS reported_venues
                                FROM app_user_reviews WHERE {condition}""",params)
        per_venue = fetch_all(db,f"""SELECT restaurant_key,{REPORT_AGGREGATES}
                                  FROM app_user_reviews WHERE {condition} GROUP BY restaurant_key""",params)
        ratings = fetch_all(db,f"""SELECT rating_score AS label,COUNT(*) AS total FROM app_user_reviews
                                WHERE {condition} AND rating_score BETWEEN 1 AND 5 GROUP BY rating_score ORDER BY label""",params)
        durations = fetch_all(db,f"""SELECT CASE WHEN actual_observed_delivery_mins<=20 THEN '20 min or less'
               WHEN actual_observed_delivery_mins<=40 THEN '21–40 min'
               WHEN actual_observed_delivery_mins<=60 THEN '41–60 min' ELSE 'Over 60 min' END AS label,
               COUNT(*) AS total,MIN(actual_observed_delivery_mins) AS sort_minutes
               FROM app_user_reviews WHERE {condition} AND order_was_cancelled=0
                 AND actual_observed_delivery_mins BETWEEN 1 AND 240 GROUP BY label ORDER BY sort_minutes""",params)
        directory, = fetch_all(db,f"SELECT COUNT(*) AS public_listings FROM {directory_relation()} r WHERE {directory_predicate()}")
        closures, = fetch_all(db, """
            SELECT COUNT(*) AS reviewed_closures
            FROM revised_directory_review a JOIN dim_restaurant r USING(restaurant_key)
            WHERE a.public_visible=FALSE AND a.verification_provenance='USER_CONFIRMED'
              AND r.bi_scope='LEGACY' AND r.operational_status='OPERATIONAL'
              AND a.operating_status IN ('CONFIRMED_CLOSED_DURATION_UNSPECIFIED','TEMPORARILY_CLOSED','PERMANENTLY_CLOSED')
        """)
    summarize_report_counts(totals)
    for row in per_venue:
        summarize_report_counts(row)
    return jsonify(normalize_json({"status":"ok","snapshot":selection[0] if selection else None,
                     "report_totals":totals,"reports_by_venue":per_venue,"ratings":ratings,
                     "durations":[{"label":r["label"],"total":r["total"]} for r in durations],
                     "public_listings":directory["public_listings"],
                     "reviewed_closures":closures["reviewed_closures"],
                     "period":None if latest else {"from":period["from"],"to":period["to"]}})),200,{"Cache-Control":"no-store"}


@app.get("/api/dashboard/model/current")
def current_bi_model():
    if not current_bi_enabled():
        return jsonify({"status": "error", "message": "Current model unavailable"}), 404
    with connection() as db:
        if versioned_bi_enabled():
            stored = scenario_publication(db)
            if not stored:
                return jsonify({"status":"error","message":"Current model unavailable"}),404
            publication = stored[0]
            facts = fetch_all(db, """
                SELECT v.*,f.reviewed_attributes
                FROM vw_bi_modeled_restaurant_day v
                JOIN fact_bi_restaurant_scenario f USING(date_key,model_version,restaurant_key)
                WHERE v.date_key=%s AND v.model_version=%s
                ORDER BY f.restaurant_key
            """,(publication["date_key"],publication["model_version"]))
            from etl.versioned_bi import read_scenario_rows
            payload = json.loads(publication["display_metadata"])
            payload["restaurants"] = sorted(read_scenario_rows(facts),key=lambda r:r["external_place_id"])
            payload["counts"]["modeled_venues"] = len(facts)
            snapshot_hash = publication["audited_snapshot_sha256"]
        else:
            stored = fetch_all(db,"SELECT payload,snapshot_sha256 FROM bi_model_snapshot WHERE model_version=%s",
                               (CURRENT_BI_MODEL,))
            if stored:
                payload = json.loads(stored[0]["payload"])
                snapshot_hash = stored[0]["snapshot_sha256"]
        if not stored:
            return jsonify({"status": "error", "message": "Current model unavailable"}), 404
        coverage, = fetch_all(db, f"""
            SELECT (SELECT COUNT(*) FROM {directory_relation()} r WHERE {directory_predicate()}) AS public_listings,
                   COUNT(*) AS genuine_reports, COUNT(DISTINCT restaurant_key) AS genuine_report_venues
            FROM app_user_reviews WHERE submission_source='GUEST'
        """)
        totals, = fetch_all(db, f"""SELECT {REPORT_AGGREGATES}
            FROM app_user_reviews WHERE submission_source='GUEST'""")
        by_venue = fetch_all(db, f"""SELECT restaurant_key, {REPORT_AGGREGATES}
            FROM app_user_reviews WHERE submission_source='GUEST' GROUP BY restaurant_key""")
        annotations = current_cuisine_annotations(db) if revised_directory() else {}
    if annotations:
        for row in payload["restaurants"]:
            annotation = annotations.get(row["external_place_id"])
            if annotation is not None:
                row["cuisine_classification"] = annotation
        payload["cuisine_distribution"] = dict(Counter(
            row.get("cuisine_classification",{}).get("label","Not specified") for row in payload["restaurants"]))
    summarize_report_counts(totals)
    for row in by_venue:
        summarize_report_counts(row)
    return jsonify({"status": "ok", "snapshot": normalize_json(payload), "coverage": coverage,
                    "snapshot_sha256": snapshot_hash,
                    "report_totals": normalize_json(totals), "reports_by_venue": normalize_json(by_venue)}), 200, {"Cache-Control": "no-store"}


@app.get("/api/exports/model/current.csv")
def export_current_bi_model():
    if not current_bi_enabled():
        return jsonify({"status": "error", "message": "Current model unavailable"}), 404
    with connection() as db:
        version = CURRENT_BI_MODEL
        if versioned_bi_enabled():
            publications = scenario_publication(db)
            version = publications[0]["audit_model_version"] if publications else None
        stored = fetch_all(db,"SELECT csv_export FROM bi_model_snapshot WHERE model_version=%s",(version,))
        annotations = current_cuisine_annotations(db) if revised_directory() and request.args.get("audit")!="1" else {}
    if not stored:
        return jsonify({"status": "error", "message": "Current model unavailable"}), 404
    content = bytes(stored[0]["csv_export"])
    if annotations:
        base = csv.DictReader(io.StringIO(content.decode("utf-8")))
        output = io.StringIO(newline="")
        keys = ("label","cuisines","specialties","establishment_type","source","evidence")
        columns = ["reviewed_cuisine","cuisine_categories","food_specialties","establishment_type","classification_source","classification_evidence"]
        writer = csv.DictWriter(output,fieldnames=[*base.fieldnames,*columns])
        writer.writeheader()
        for row in base:
            annotation = annotations.get(row["external_place_id"],{})
            values = {}
            for column,key in zip(columns,keys):
                value = annotation.get(key)
                text = "; ".join(value) if isinstance(value,list) else str(value or "")
                values[column] = "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text
            writer.writerow({**row,**values})
        content = output.getvalue().encode("utf-8")
    return Response(content, mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{version}.csv"',
                             "Cache-Control": "no-store"})


@app.get("/dashboard/schema/versioned-bi.sql")
def versioned_bi_schema():
    return send_from_directory(PROJECT_ROOT / "database","13_versioned_bi.sql",mimetype="text/plain")


@app.get("/dashboard/schema/warehouse-methodology")
def warehouse_methodology():
    return send_from_directory(PROJECT_ROOT / "docs","VERSIONED_BI_WAREHOUSE.md",mimetype="text/plain")


@app.get("/dashboard/")
def serve_dashboard():
    return serve_frontend("admin/index.html", live_required=True)


@app.get("/")
def serve_public():
    if FRONTEND_ROOT.joinpath("index.html").is_file():
        return serve_frontend("index.html", live_required=os.getenv("BLUEPLATE_ENV", "").lower() == "production")
    return jsonify({"service": "BluePlate V8 API", "hint": "Place V8 frontend/ beside etl/ to serve it here"})


@app.get("/admin/")
def serve_admin():
    if os.getenv("BLUEPLATE_ENV", "development").lower() == "production":
        return jsonify({"status": "error", "message": "Admin sign-in not implemented"}), 403
    if current_bi_enabled():
        return redirect("/dashboard/")
    return serve_frontend("admin/index.html")


@app.get("/assets/<path:filename>")
def serve_assets(filename):
    if (os.getenv("BLUEPLATE_ENV", "").lower() == "production"
            and filename not in {"app.js", "api-bridge.js", "style.css", "blueplate-original-logo.png"}):
        return jsonify({"status": "error", "message": "Not found"}), 404
    if not FRONTEND_ROOT.joinpath("assets").is_dir():
        return jsonify({"status": "error", "message": "Frontend not installed"}), 404
    return send_from_directory(FRONTEND_ROOT / "assets", filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("FLASK_PORT", "5000")),
            debug=os.getenv("BLUEPLATE_ENV") == "development"
                  and os.getenv("FLASK_DEBUG", "false").lower() == "true")
