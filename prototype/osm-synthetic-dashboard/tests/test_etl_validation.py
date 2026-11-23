"""Collector/proxy checks run without hitting external services."""
import sqlite3
import unittest
from unittest.mock import Mock, patch

from etl.proxy_metrics_engine import (
    assign_ust_zone_code, compute_cancellation_proxy, compute_delivery_eta_proxy,
)
from etl.ust_api_collector import fetch_ust_eateries_osm_overpass
from etl.warehouse_loader import upsert_modeled_daily_metrics


class FakeOverpassResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return {
            "elements": [
                {
                    "type": "node",
                    "id": 1001,
                    "lat": 14.609,
                    "lon": 120.990,
                    "tags": {"name": "Cafe Test", "amenity": "cafe", "cuisine": "coffee_shop"},
                },
                {
                    "type": "node",
                    "id": 1002,
                    "lat": 14.610,
                    "lon": 120.989,
                    "tags": {"amenity": "restaurant"},  # Unnamed node should be skipped
                },
            ]
        }


class TestCollection(unittest.TestCase):
    @patch("etl.ust_api_collector.requests.post", return_value=FakeOverpassResponse())
    def test_osm_overpass_collector(self, post):
        restaurants = fetch_ust_eateries_osm_overpass()
        self.assertEqual(len(restaurants), 1)
        self.assertEqual(restaurants[0]["external_place_id"], "osm_node_1001")
        self.assertEqual(restaurants[0]["restaurant_name"], "Cafe Test")

    def test_proxy_thresholds(self):
        self.assertEqual(compute_cancellation_proxy(0, 32, 0)[1], "WARNING")
        self.assertEqual(compute_delivery_eta_proxy(0.5, 10, True)[2], "NORMAL")
        self.assertEqual(assign_ust_zone_code(14.6119, 120.9888), "UST-DAPITAN")


def test_modeled_upsert_preserves_existing_rating():
    cursor = Mock()
    upsert_modeled_daily_metrics(cursor, 20261115, 1, 2)
    sql, params = cursor.execute.call_args.args
    # Execute the actual insert and update expressions against disposable SQLite.
    sql = sql.replace("%s", "?").replace("ON DUPLICATE KEY UPDATE", "ON CONFLICT(date_key, restaurant_key) DO UPDATE SET")
    sql = sql.replace("VALUES(zone_key)", "excluded.zone_key")
    with sqlite3.connect(":memory:") as db:
        db.executescript("""
            CREATE TABLE fact_restaurant_daily_metrics (
                date_key INT, restaurant_key INT, zone_key INT, avg_rating REAL,
                total_review_count INT, daily_new_reviews INT, estimated_order_volume INT, severity_level TEXT,
                UNIQUE(date_key, restaurant_key)
            );
            INSERT INTO fact_restaurant_daily_metrics VALUES (20261115,1,1,3.75,8,0,25,'NORMAL');
        """)
        db.execute(sql, params)
        db.execute(sql, (20261115, 2, 1))
        rows = db.execute("""
            SELECT restaurant_key, zone_key, avg_rating, total_review_count
            FROM fact_restaurant_daily_metrics ORDER BY restaurant_key
        """).fetchall()
    assert rows == [(1, 2, 3.75, 8), (2, 1, 4.3, 0)]


if __name__ == "__main__":
    unittest.main()