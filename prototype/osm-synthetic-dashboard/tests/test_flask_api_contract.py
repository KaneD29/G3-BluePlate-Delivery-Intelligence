"""Test Flask endpoint contracts without touching a real MySQL server."""
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date
from threading import Barrier, Lock
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

flask = pytest.importorskip("flask")
pytest.importorskip("mysql.connector")

from web_app_example import flask_db_connector as api


@pytest.fixture
def client():
    api.app.testing = True
    return api.app.test_client()


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json()["service"] == "blueplate-local-flask"


def test_invalid_period_is_rejected_before_db(client):
    response = client.get("/api/dashboard/overview?from=2026-11-08&to=2026-11-01")
    assert response.status_code == 400
    assert "Date range" in response.get_json()["message"]


def test_guest_endpoint_disabled_by_default(client, monkeypatch):
    monkeypatch.delenv("ENABLE_GUEST_REPORTS", raising=False)
    response = client.post("/api/user/reviews", json={"restaurant_key": 1})
    assert response.status_code == 503


@pytest.fixture(autouse=True)
def forbid_real_mysql(monkeypatch):
    def unexpected_connection(**kwargs):
        pytest.fail("Unexpected real MySQL connection")
    monkeypatch.setattr(api.mysql.connector, "connect", unexpected_connection)


@pytest.fixture
def pilot(monkeypatch):
    monkeypatch.setenv("BLUEPLATE_ENV", "development")
    monkeypatch.setenv("ENABLE_GUEST_REPORTS", "true")
    monkeypatch.setenv("ENABLE_SYNTHETIC_DEMO", "false")
    monkeypatch.setitem(api.app.config, "SECRET_KEY", "unit-test-key-" * 4)
    monkeypatch.setattr(api, "_guest_counts", {})
    monkeypatch.setattr(api, "_guest_window_end", 0)


def guest_headers(client):
    response = client.get("/api/session", base_url="http://localhost")
    assert response.headers["Cache-Control"] == "no-store"
    capabilities = response.get_json()
    assert capabilities["guest_reports_enabled"]
    return {"Origin": "http://localhost", "X-BluePlate-Form-Token": capabilities["guest_form_token"]}


def submit(client, payload=None, headers=None):
    return client.post("/api/user/reviews", base_url="http://localhost",
                       json=payload or {"restaurant_key": 1}, headers=headers)


def report(**overrides):
    return {
        "restaurant_key": 1, "rating_score": 5, "order_was_cancelled": False,
        "actual_observed_delivery_mins": 28, "comment_text": "Private comment",
        "client_submission_id": str(uuid4()), **overrides,
    }


@pytest.mark.parametrize(("env", "synthetic", "peer", "host"), [
    ("production", "false", "127.0.0.1", "localhost"),
    ("staging", "false", "127.0.0.1", "localhost"),
    ("", "false", "127.0.0.1", "localhost"),
    ("development", "true", "127.0.0.1", "localhost"),
    ("development", "false", "192.0.2.5", "localhost"),
    ("development", "false", "127.0.0.1", "untrusted.test"),
])
def test_guest_capability_and_write_share_gate(client, pilot, monkeypatch, env, synthetic, peer, host):
    monkeypatch.setenv("BLUEPLATE_ENV", env)
    monkeypatch.setenv("ENABLE_SYNTHETIC_DEMO", synthetic)
    options = dict(base_url=f"http://{host}", environ_overrides={"REMOTE_ADDR": peer})
    capabilities = client.get("/api/session", **options).get_json()
    assert not capabilities["guest_reports_enabled"]
    assert "guest_form_token" not in capabilities
    assert client.post("/api/user/reviews", json=report(), **options).status_code == 503


def test_guest_requires_a_configured_session_secret(client, pilot, monkeypatch):
    monkeypatch.setitem(api.app.config, "SECRET_KEY", "")
    assert not client.get("/api/session").get_json()["guest_reports_enabled"]
    assert submit(client, report()).status_code == 503


def test_origin_and_token_are_required_and_bound_to_session(client, pilot, monkeypatch):
    headers = guest_headers(client)
    cookie = client.get_cookie(api.app.config["SESSION_COOKIE_NAME"])
    assert cookie.http_only and cookie.same_site == "Strict"
    assert submit(client, report(), {**headers, "Origin": "http://localhost:1234"}).status_code == 403
    assert submit(client, report(), {"Origin": "http://localhost"}).status_code == 403
    assert submit(api.app.test_client(), report(), headers).status_code == 403
    monkeypatch.setattr(api, "GUEST_TOKEN_SECONDS", -1)
    assert submit(client, report(), headers).status_code == 403


@pytest.mark.parametrize(("overrides", "field"), [
    ({"actual_observed_delivery_mins": None}, "actual_observed_delivery_mins"),
    ({"actual_observed_delivery_mins": 3, "order_was_cancelled": True}, "Cancelled orders"),
    ({"client_submission_id": None}, "client_submission_id"),
    ({"rating_score": 6}, "rating_score"),
])
def test_guest_input_validation_no_db(client, pilot, overrides, field):
    response = submit(client, report(**overrides), guest_headers(client))
    assert response.status_code == 400
    assert field in response.get_json()["message"]


def test_guest_rate_limits_session_and_peer(client, pilot, monkeypatch):
    clock = Mock(return_value=100)
    monkeypatch.setattr(api, "monotonic", clock)
    monkeypatch.setattr(api, "GUEST_SESSION_LIMIT", 1)
    monkeypatch.setattr(api, "GUEST_PEER_LIMIT", 2)
    headers = guest_headers(client)
    assert submit(client, headers=headers).status_code == 400
    limited = submit(client, headers=headers)
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "60"
    second = api.app.test_client()
    assert submit(second, headers=guest_headers(second)).status_code == 400
    third = api.app.test_client()
    third_headers = guest_headers(third)
    clock.return_value = 110
    limited = submit(third, headers=third_headers)
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "50"
    clock.return_value = 160
    assert submit(third, headers=third_headers).status_code == 400


@pytest.fixture
def memory_reviews(monkeypatch):
    # Use SQLite's real UNIQUE constraint and translate its duplicate error to MySQL's.
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE app_user_reviews (
            user_review_id INTEGER PRIMARY KEY, user_id INTEGER, submission_source TEXT,
            restaurant_key INTEGER, actual_observed_delivery_mins INTEGER,
            order_was_cancelled INTEGER, rating_score INTEGER, comment_text TEXT,
            client_submission_id TEXT UNIQUE, submitted_at TEXT DEFAULT '2020-11-15 00:00:00'
        );
        CREATE TABLE dim_restaurant (
            restaurant_key INTEGER, operational_status TEXT, external_place_id TEXT,
            restaurant_name TEXT, branch_label TEXT, distance_to_ust_km REAL, price_level INTEGER,
            street_address TEXT, zone_key INTEGER, primary_cuisine_key INTEGER
        );
        CREATE TABLE dim_zone (zone_key INTEGER, zone_name TEXT);
        CREATE TABLE dim_cuisine (cuisine_key INTEGER, cuisine_name TEXT);
        CREATE TABLE dim_alert_threshold (
            metric_code TEXT, warning_limit REAL, critical_limit REAL, is_active INTEGER
        );
        CREATE TABLE vw_v8_restaurant_daily_signals (
            restaurant_key INTEGER, date_key INTEGER, report_date TEXT, total_review_count INTEGER,
            public_avg_rating REAL, modeled_demand INTEGER, proxy_delivery_mins REAL,
            cancellation_risk_index REAL, avg_menu_price_php REAL
        );
        INSERT INTO dim_restaurant VALUES
            (1, 'OPERATIONAL', 'osm_1', 'Example', NULL, 0.5, 1, 'UST', 1, 1),
            (2, 'PERMANENTLY_CLOSED', 'osm_2', 'Closed', NULL, 0.5, 1, 'UST', 1, 1);
        INSERT INTO dim_zone VALUES (1, 'UST');
        INSERT INTO dim_cuisine VALUES (1, 'Cafe');
        INSERT INTO vw_v8_restaurant_daily_signals VALUES (1, 20201115, '2020-11-15', 2, 4, 25, 20, 3, NULL);
    """)
    lock = Lock()

    @contextmanager
    def connection():
        with lock, db:
            yield db

    def execute(connection, sql, params):
        try:
            cursor = connection.execute(sql.replace("%s", "?"), params)
        except sqlite3.IntegrityError as exc:
            assert exc.sqlite_errorname == "SQLITE_CONSTRAINT_UNIQUE"
            raise api.mysql.connector.IntegrityError(errno=api.ER_DUP_ENTRY) from exc
        return cursor.lastrowid, cursor.rowcount

    def fetch(connection, sql, params=()):
        values = tuple(value.isoformat() if isinstance(value, date) else value for value in params)
        rows = [dict(row) for row in connection.execute(sql.replace("%s", "?"), values)]
        for row in rows:
            if "submitted_at" in row:
                row["submitted_at"] = api.datetime.fromisoformat(row["submitted_at"])
        return rows

    monkeypatch.setattr(api, "connection", connection)
    monkeypatch.setattr(api, "execute", execute)
    monkeypatch.setattr(api, "fetch_all", fetch)
    try:
        yield db
    finally:
        db.close()


def test_guest_write_replay_conflict_and_feed(client, pilot, memory_reviews):
    headers = guest_headers(client)
    payload = report(comment_text="  Private comment  ")
    first = submit(client, payload, headers)
    assert first.status_code == 201
    receipt = first.get_json()["user_review_id"]
    replay = submit(client, {**payload, "restaurant_key": "1", "comment_text": "Private comment"}, headers)
    assert replay.status_code == 200
    assert replay.get_json() == {"status": "replayed", "user_review_id": receipt}
    assert submit(client, {**payload, "rating_score": 4}, headers).status_code == 409
    assert submit(client, report(restaurant_key=2), headers).status_code == 400
    assert [tuple(row) for row in memory_reviews.execute(
        "SELECT user_id, submission_source, comment_text FROM app_user_reviews"
    )] == [(None, "GUEST", "Private comment")]
    feed = client.get("/api/user/reviews").get_json()["reviews"]
    assert len(feed) == 1
    assert feed[0]["rating_score"] == 5
    assert feed[0]["submitted_at"] == "2020-11-15T00:00:00+08:00"
    assert "comment_text" not in feed[0]
    assert "client_submission_id" not in feed[0]


def test_concurrent_guest_retries_return_one_receipt(pilot, memory_reviews):
    payload = report()
    ready = Barrier(2)

    def attempt():
        browser = api.app.test_client()
        headers = guest_headers(browser)
        ready.wait(timeout=5)
        response = submit(browser, payload, headers)
        return response.status_code, response.get_json()["user_review_id"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = sorted(pool.map(lambda _: attempt(), range(2)))
    assert outcomes == [(200, 1), (201, 1)]
    assert memory_reviews.execute("SELECT COUNT(*) FROM app_user_reviews").fetchone()[0] == 1


def test_api_mysql_session_uses_manila_time(monkeypatch):
    database = Mock()
    monkeypatch.setattr(api.mysql.connector, "connect", Mock(return_value=database))
    with api.connection() as conn:
        assert conn.time_zone == "+08:00"
    database.commit.assert_called_once()
    database.close.assert_called_once()


def test_manila_report_boundaries_and_modeled_metrics(client, pilot, memory_reviews):
    headers = guest_headers(client)
    responses = [
        submit(client, report(rating_score=score, actual_observed_delivery_mins=minutes,
                              order_was_cancelled=cancelled), headers)
        for score, minutes, cancelled in [(1, 90, False), (5, 28, False), (3, None, True), (2, 80, False)]
    ]
    assert all(response.status_code == 201 for response in responses)
    dates = ("2020-11-14 23:59:59", "2020-11-15 00:00:00", "2020-11-15 23:59:59", "2020-11-16 00:00:00")
    with memory_reviews:
        for response, date in zip(responses, dates):
            memory_reviews.execute("UPDATE app_user_reviews SET submitted_at=? WHERE user_review_id=?",
                                   (date, response.get_json()["user_review_id"]))
    row, = client.get("/api/dashboard/overview?from=2020-11-15&to=2020-11-15").get_json()["restaurants"]
    assert row["auditor_report_count"] == 2
    assert row["auditor_avg_rating"] == 4
    assert row["observed_delivery_mins"] == 28
    assert row["proxy_delivery_mins"] == 20
    assert row["modeled_demand"] == 25
    assert row["cancellation_risk_index"] == 3
    coverage = client.get("/api/dashboard/coverage").json
    assert coverage["latest_reporting_date"] == "2020-11-15"
    assert coverage["latest_report_submission_date"] == "2020-11-16"
    assert row["report_rating_count"] == 2
    assert row["completed_delivery_count"] == 1
    assert row["cancelled_report_count"] == 1
    assert row["known_outcome_count"] == 2
    assert row["reported_cancellation_share"] == 0.5
    report_only, = client.get("/api/dashboard/overview?from=2020-11-16&to=2020-11-16").get_json()["restaurants"]
    assert report_only["auditor_report_count"] == 1
    assert report_only["observed_delivery_mins"] == 80
    assert report_only["proxy_delivery_mins"] is None


def test_report_denominators_and_no_blending(client, memory_reviews):
    def overview():
        return client.get("/api/dashboard/overview?from=2020-11-15&to=2020-11-15").json

    def seed(score, cancelled, minutes, venue=1):
        memory_reviews.execute("""
            INSERT INTO app_user_reviews (restaurant_key, rating_score, order_was_cancelled,
                                         actual_observed_delivery_mins)
            VALUES (?, ?, ?, ?)""", (venue, score, cancelled, minutes))

    with memory_reviews:
        memory_reviews.executemany("INSERT INTO dim_alert_threshold VALUES (?, ?, ?, 1)", [
            ("DELIVERY_ETA_MINS", 35, 45), ("CANCELLATION_PROXY_PCT", 8, 15), ("AVG_RATING", 4, 3.6),
        ])

    empty = overview()["report_totals"]
    assert tuple(empty[key] for key in api.REPORT_COUNTS) == (0, 0, 0, 0, 0)
    assert empty["reported_cancellation_share"] is None
    assert empty["observed_delivery_mins"] is None and empty["auditor_avg_rating"] is None

    with memory_reviews:
        seed(1, 1, None)
    one = overview()
    row, = one["restaurants"]
    assert row["public_avg_rating"] == 4 and row["warehouse_rating_days"] == 1
    assert row["auditor_avg_rating"] == 1 and row["overall_health_status"] == "NORMAL"
    assert "blended_rating" not in row
    assert row["report_rating_count"] == 1
    assert row["completed_delivery_count"] == 0 and row["observed_delivery_mins"] is None
    assert row["reported_cancellation_share"] == 1

    with memory_reviews:
        seed(5, 0, 20)
        seed(4, 0, 241)  # Legacy out-of-range delivery time.
        seed(3, 0, None)  # Legacy incomplete delivery time.
        seed(0, 2, 30)    # Legacy row with neither eligible rating nor known outcome.
        seed(5, 0, 80, venue=2)  # Inactive venue still counts in overall accepted totals.
        memory_reviews.execute("UPDATE vw_v8_restaurant_daily_signals SET public_avg_rating=4.30, total_review_count=0")
    many = overview()
    row, = many["restaurants"]
    assert row["public_avg_rating"] is None and row["warehouse_rating_days"] == 0
    assert row["overall_health_status"] == "UNKNOWN"
    assert tuple(row[key] for key in api.REPORT_COUNTS) == (5, 4, 1, 1, 4)
    assert row["observed_delivery_mins"] == 20 and row["reported_cancellation_share"] == 0.25
    totals = many["report_totals"]
    assert tuple(totals[key] for key in api.REPORT_COUNTS) == (6, 5, 2, 1, 5)
    assert totals["observed_delivery_mins"] == 50 and totals["reported_cancellation_share"] == 0.2


def test_admin_html_forbidden_in_production(client, monkeypatch):
    monkeypatch.setenv("BLUEPLATE_ENV", "production")
    response = client.get("/admin/")
    assert response.status_code == 403


def test_period_restaurants_mocked(client):
    from contextlib import contextmanager

    @contextmanager
    def fake_db():
        yield object()

    sample = [{"restaurant_key": 1, "restaurant_name": "Example", "days_observed": None,
               "public_avg_rating": None, "proxy_delivery_mins": None,
               "cancellation_risk_index": None, "modeled_demand": None,
               "overall_health_status": "UNKNOWN"}]
    with (patch.object(api, "connection", fake_db),
          patch.object(api, "period_restaurants", return_value=sample),
          patch.object(api, "report_totals", return_value={"auditor_report_count": 0})):
        response = client.get("/api/dashboard/overview?from=2026-11-01&to=2026-11-07")
    assert response.status_code == 200
    assert response.get_json()["restaurants"][0]["overall_health_status"] == "UNKNOWN"


@pytest.mark.parametrize("operational_history, expected", [(True, "2020-11-15"), (False, None)])
def test_reporting_coverage(client, monkeypatch, operational_history, expected):

    with sqlite3.connect(":memory:") as db:
        db.executescript("""
            CREATE TABLE dim_restaurant (restaurant_key INTEGER, operational_status TEXT);
            CREATE TABLE vw_v8_restaurant_daily_signals (restaurant_key INTEGER, report_date TEXT);
            CREATE TABLE app_user_reviews (submitted_at TEXT);
            INSERT INTO app_user_reviews VALUES ('2020-11-20 23:59:59'), ('9999-12-31 00:00:00');
            INSERT INTO dim_restaurant VALUES (1, 'OPERATIONAL'), (2, 'CLOSED');
            INSERT INTO vw_v8_restaurant_daily_signals
            VALUES (2, '2020-11-19'), (1, NULL), (1, '9999-12-31');
        """)
        if operational_history:
            db.executemany("INSERT INTO vw_v8_restaurant_daily_signals VALUES (1, ?)",
                           [("2020-11-13",), ("2020-11-15",)])

        @contextmanager
        def fake_db():
            yield db

        def select(connection, sql, params):
            assert sql.strip().startswith("SELECT")
            warehouse_day, report_day = connection.execute(
                sql.replace("%s", "?"), tuple(d.isoformat() for d in params)
            ).fetchone()
            return [{"latest_reporting_date": warehouse_day, "latest_report_submission_date": report_day}]

        monkeypatch.setattr(api, "connection", fake_db)
        monkeypatch.setattr(api, "fetch_all", select)
        response = client.get("/api/dashboard/coverage")

    assert response.status_code == 200
    assert response.get_json() == {
        "status": "ok", "latest_reporting_date": expected, "data_origin": "warehouse",
        "latest_report_submission_date": "2020-11-20",
    }


PRODUCTION_ORIGIN = "https://blueplate.example.test"
PROXY_HEADERS = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "192.0.2.15"}


@pytest.fixture
def production(pilot, monkeypatch):
    for key, value in {
        "BLUEPLATE_ENV": "production",
        "ENABLE_PRODUCTION_GUEST_REPORTS": "true",
        "BLUEPLATE_PUBLIC_ORIGIN": PRODUCTION_ORIGIN,
        "BLUEPLATE_TRUSTED_PROXY_IP": "127.0.0.1",
        "BLUEPLATE_TRUSTED_PROXY_HOPS": "1",
        "BLUEPLATE_TURNSTILE_SITE_KEY": "mock-turnstile-site-key",
        "BLUEPLATE_TURNSTILE_SECRET_KEY": "mock-turnstile-secret-key",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setitem(api.app.config, "SESSION_COOKIE_SECURE", True)

    def no_provider(*args, **kwargs):
        pytest.fail("Unexpected real challenge provider request")
    monkeypatch.setattr("web_app_example.production_guest.requests.post", no_provider)


def production_headers(client):
    response = client.get("/api/session", base_url=PRODUCTION_ORIGIN, headers=PROXY_HEADERS)
    caps = response.get_json()
    assert caps["guest_reports_enabled"]
    assert not caps["synthetic_demo_enabled"]
    assert caps["guest_challenge"] == {"site_key": "mock-turnstile-site-key", "action": "blueplate_guest_report"}
    assert b"mock-turnstile-secret-key" not in response.data
    cookie = response.headers["Set-Cookie"]
    assert all(flag in cookie for flag in ("Secure", "HttpOnly", "SameSite=Strict"))
    assert "Domain=" not in cookie
    return {**PROXY_HEADERS, "Origin": PRODUCTION_ORIGIN, "X-BluePlate-Form-Token": caps["guest_form_token"]}


def production_submit(client, headers, payload):
    return client.post("/api/user/reviews", base_url=PRODUCTION_ORIGIN, headers=headers, json=payload)


def test_production_pages_and_private_endpoints(client, production):
    public = client.get("/").data
    assert b'href="/dashboard/"' in public
    assert b"Submit practice report" not in public
    dashboard = client.get("/dashboard/")
    assert dashboard.status_code == 200
    for markup in (public, dashboard.data):
        assert b'data-live-required="true"' in markup
        assert b"sample-data.js" not in markup
        assert b"blueplate-synthetic-demo.js" not in markup
        assert b"manager-note-form" not in markup
    assert client.get("/admin/").status_code == 403
    assert client.get("/assets/sample-data.js").status_code == 404
    assert client.get("/assets/app.js").status_code == 200
    for method, url in (
        ("GET", "/api/exports/reports.csv"), ("GET", "/api/manager/actions"),
        ("POST", "/api/manager/actions"), ("PATCH", "/api/manager/actions/1"),
        ("DELETE", "/api/manager/actions/1"), ("PATCH", "/api/dashboard/alerts/1"),
        ("POST", "/api/etl/refresh"),
    ):
        assert client.open(url, method=method, json={}).status_code == 404


def test_local_admin_preserves_demo_assets(client, pilot):
    response = client.get("/admin/")
    assert response.status_code == 200
    assert b"sample-data.js" in response.data and b"manager-note-form" in response.data
    assert b"data-live-required" not in response.data


@pytest.mark.parametrize(("key", "value"), [
    ("ENABLE_PRODUCTION_GUEST_REPORTS", None),
    ("ENABLE_PRODUCTION_GUEST_REPORTS", "false"),
    ("BLUEPLATE_PUBLIC_ORIGIN", "http://blueplate.example.test"),
    ("BLUEPLATE_PUBLIC_ORIGIN", "https://blueplate.example.test/"),
    ("BLUEPLATE_PUBLIC_ORIGIN", "https://blueplate.example.test:443"),
    ("BLUEPLATE_TRUSTED_PROXY_HOPS", "2"),
    ("BLUEPLATE_TRUSTED_PROXY_IP", ""),
    ("BLUEPLATE_TURNSTILE_SECRET_KEY", ""),
    ("BLUEPLATE_TURNSTILE_SITE_KEY", "bad key"),
    ("ENABLE_SYNTHETIC_DEMO", "true"),
])
def test_production_bad_config_fails_closed(client, production, monkeypatch, key, value):
    if value is None:
        monkeypatch.delenv(key)
    else:
        monkeypatch.setenv(key, value)
    caps = client.get("/api/session", base_url=PRODUCTION_ORIGIN, headers=PROXY_HEADERS).get_json()
    assert not caps["guest_reports_enabled"]
    assert "guest_form_token" not in caps and "guest_challenge" not in caps
    assert production_submit(client, PROXY_HEADERS, report()).status_code == 503


@pytest.mark.parametrize(("key", "value"), [
    ("SECRET_KEY", "short"), ("SESSION_COOKIE_SECURE", False),
    ("SESSION_COOKIE_SAMESITE", "Lax"), ("SESSION_COOKIE_HTTPONLY", False),
    ("SESSION_COOKIE_DOMAIN", "example.test"),
])
def test_production_cookie_configuration_required(client, production, monkeypatch, key, value):
    monkeypatch.setitem(api.app.config, key, value)
    assert not client.get("/api/session", base_url=PRODUCTION_ORIGIN, headers=PROXY_HEADERS).json["guest_reports_enabled"]
    assert production_submit(client, PROXY_HEADERS, report()).status_code == 503


@pytest.mark.parametrize(("headers", "peer", "base_url"), [
    (PROXY_HEADERS, "192.0.2.99", PRODUCTION_ORIGIN),
    ({}, "127.0.0.1", PRODUCTION_ORIGIN),
    ({**PROXY_HEADERS, "X-Forwarded-Proto": "http"}, "127.0.0.1", PRODUCTION_ORIGIN),
    ({**PROXY_HEADERS, "X-Forwarded-Proto": "https, http"}, "127.0.0.1", PRODUCTION_ORIGIN),
    ({**PROXY_HEADERS, "X-Forwarded-For": "192.0.2.1, 192.0.2.2"}, "127.0.0.1", PRODUCTION_ORIGIN),
    ({**PROXY_HEADERS, "X-Forwarded-For": "127.0.0.1"}, "127.0.0.1", PRODUCTION_ORIGIN),
    ({**PROXY_HEADERS, "X-Forwarded-Host": "blueplate.example.test"}, "127.0.0.1", "https://spoof.example.test"),
])
def test_production_rejects_ambiguous_proxy_headers(client, production, headers, peer, base_url):
    options = dict(base_url=base_url, headers=headers, environ_overrides={"REMOTE_ADDR": peer})
    assert not client.get("/api/session", **options).json["guest_reports_enabled"]
    assert client.post("/api/user/reviews", json=report(), **options).status_code == 503


def test_production_origin_tokens_and_throttling(client, production, monkeypatch):
    headers = production_headers(client)
    monkeypatch.setattr(api, "GUEST_PEER_LIMIT", 2)
    payload = report(challenge_response="test-response")
    assert production_submit(client, {**headers, "Origin": "http://blueplate.example.test"}, payload).status_code == 403
    assert production_submit(api.app.test_client(), headers, payload).status_code == 403
    limited = production_submit(client, headers, payload)
    assert limited.status_code == 429
    assert 1 <= int(limited.headers["Retry-After"]) <= 60
    second_peer = {**headers, "X-Forwarded-For": "192.0.2.16", "X-BluePlate-Form-Token": "invalid"}
    assert production_submit(client, second_peer, payload).status_code == 403


@pytest.mark.parametrize(("verdict", "status", "expected"), [
    ({"success": False}, 200, 403),
    ({"success": True, "hostname": "other.example.test", "action": "blueplate_guest_report"}, 200, 403),
    ({"success": True, "hostname": "blueplate.example.test", "action": "other"}, 200, 403),
    ([], 200, 503),
    ({}, 302, 503),
])
def test_production_challenge_rejection(client, production, monkeypatch, verdict, status, expected):
    provider = Mock(return_value=Mock(status_code=status, json=Mock(return_value=verdict)))
    monkeypatch.setattr("web_app_example.production_guest.requests.post", provider)
    response = production_submit(client, production_headers(client), report(challenge_response="mock-response"))
    assert response.status_code == expected
    provider.assert_called_once()


def test_production_requires_challenge_token(client, production):
    headers = production_headers(client)
    assert production_submit(client, headers, report()).status_code == 403
    assert production_submit(client, headers, report(challenge_response="x" * 2049)).status_code == 403


def test_production_provider_timeout_fails_closed(client, production, monkeypatch):
    monkeypatch.setattr("web_app_example.production_guest.requests.post",
                        Mock(side_effect=api.RequestException("private provider response")))
    response = production_submit(client, production_headers(client), report(challenge_response="mock-response"))
    assert response.status_code == 503
    assert b"private provider response" not in response.data


def test_production_challenge_and_idempotent_write(client, production, monkeypatch, memory_reviews):
    provider = Mock(return_value=Mock(status_code=200, json=Mock(return_value={
        "success": True, "hostname": "blueplate.example.test", "action": "blueplate_guest_report",
    })))
    monkeypatch.setattr("web_app_example.production_guest.requests.post", provider)
    headers = production_headers(client)
    payload = report()
    first = production_submit(client, headers, {**payload, "challenge_response": "first-token"})
    assert first.status_code == 201
    assert provider.call_args.kwargs == {
        "data": {"secret": "mock-turnstile-secret-key", "remoteip": "192.0.2.15", "response": "first-token"},
        "timeout": (2, 4), "allow_redirects": False,
    }
    replay = production_submit(client, headers, {**payload, "challenge_response": "fresh-token"})
    assert replay.status_code == 200 and replay.json["user_review_id"] == first.json["user_review_id"]
    assert provider.call_count == 2
    assert memory_reviews.execute("SELECT COUNT(*) FROM app_user_reviews").fetchone()[0] == 1
    assert "comment_text" not in client.get("/api/user/reviews").json["reviews"][0]


@pytest.mark.parametrize("failure", [None, "connect", "schema", "index"])
def test_readiness_only_probes_schema_and_is_generic(client, monkeypatch, failure):
    database = Mock()
    context = Mock(__enter__=Mock(return_value=database), __exit__=Mock(return_value=False))
    connect = Mock(return_value=context)
    if failure == "connect":
        connect.side_effect = api.mysql.connector.Error("private DSN")
    monkeypatch.setattr(api.mysql.connector, "connect", connect)

    def fetch(db, query):
        assert db is database
        assert query.strip().startswith("SELECT ")
        if failure == "schema":
            raise api.mysql.connector.Error("private DSN")
        if "information_schema.STATISTICS" in query:
            indexes = [
                ("uk_review_client_submission", 0, 1, "client_submission_id", None),
                ("idx_user_review_time", 1, 1, "submitted_at", None),
                ("idx_user_review_time", 1, 2, "restaurant_key", None),
            ]
            if failure == "index":
                indexes.pop()
            keys = ("index_name", "non_unique", "position", "column_name", "sub_part")
            return [dict(zip(keys, row)) for row in indexes]
        assert query.endswith(" LIMIT 0")
        return []

    probe = Mock(side_effect=fetch)
    monkeypatch.setattr(api, "fetch_all", probe)
    response = client.get("/api/ready")
    assert response.status_code == (503 if failure else 200)
    assert response.json == {"status": "unavailable" if failure else "ready"}
    assert response.headers["Cache-Control"] == "no-store"
    database.commit.assert_not_called()
    if not failure:
        assert probe.call_count == 9


@pytest.mark.parametrize("mode,path", [
    ("development", "/"), ("development", "/admin/"), ("development", "/dashboard/"),
    ("production", "/"), ("production", "/dashboard/"),
])
def test_presentation_links_in_flask_modes(client, monkeypatch, mode, path):
    monkeypatch.setenv("BLUEPLATE_ENV", mode)
    response = client.get(path)
    assert response.status_code == 200
    assert response.data.count(b'href="/"') == 2  # Logo and report navigation.
    assert response.data.count(b'href="/dashboard/"') == 1
    assert response.data.count(b'BI Dashboard</a>') == 1
    if path == "/":
        assert b'href="/dashboard/#data-methodology"' in response.data
        assert b'min="1" max="240" step="1"' in response.data
        assert b'value="no" checked' not in response.data
        assert b'id="rating-value" value=""' in response.data
    else:
        assert b'id="data-methodology"' in response.data
        assert b'ceb7a271ada825cfe721c3a9850b2ca74e093b86' in response.data
        assert b'06_v8_oltp_migration.sql' in response.data
        assert b'07_v8_daily_analytics_view.sql' in response.data
    assert client.get("/database/06_v8_oltp_migration.sql").status_code == 404
