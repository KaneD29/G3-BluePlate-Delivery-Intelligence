"""Test Flask endpoint contracts without touching a real MySQL server."""
from unittest.mock import patch

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


def test_guest_input_validation_no_db(client, monkeypatch):
    monkeypatch.setenv("ENABLE_GUEST_REPORTS", "true")
    monkeypatch.setenv("BLUEPLATE_ENV", "development")
    response = client.post("/api/user/reviews", json={
        "restaurant_key": 1, "rating_score": 5,
        "order_was_cancelled": False, "actual_observed_delivery_mins": None,
        "comment_text": "Good"})
    assert response.status_code == 400
    assert "actual_observed_delivery_mins" in response.get_json()["message"]


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
    with patch.object(api, "connection", fake_db), patch.object(api, "period_restaurants", return_value=sample):
        response = client.get("/api/dashboard/overview?from=2026-11-01&to=2026-11-07")
    assert response.status_code == 200
    assert response.get_json()["restaurants"][0]["overall_health_status"] == "UNKNOWN"
