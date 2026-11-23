"""Collector/proxy checks run without hitting external services."""
import sqlite3
import unittest
from unittest.mock import Mock, patch

from etl.proxy_metrics_engine import (
    assign_ust_zone_code, compute_cancellation_proxy, compute_delivery_eta_proxy,
)
from etl.ust_api_collector import fetch_ust_eateries_osm_overpass
from etl.warehouse_loader import run_etl_pipeline, upsert_modeled_daily_metrics


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


def test_restaurant_import_preserves_status_and_report_identity():
    # Run the actual importer with a mocked MySQL connection. Execute its venue
    # upsert and identity lookup against disposable SQLite with equivalent SQL.
    with sqlite3.connect(":memory:") as db:
        db.row_factory = sqlite3.Row
        db.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE dim_restaurant (
                restaurant_key INTEGER PRIMARY KEY, external_place_id TEXT UNIQUE NOT NULL,
                restaurant_name TEXT, zone_key INTEGER, primary_cuisine_key INTEGER,
                street_address TEXT, latitude REAL, longitude REAL, distance_to_ust_km REAL,
                operational_status TEXT NOT NULL, first_seen_date TEXT
            );
            CREATE TABLE app_user_reviews (
                user_review_id INTEGER PRIMARY KEY,
                restaurant_key INTEGER NOT NULL REFERENCES dim_restaurant(restaurant_key)
            );
            INSERT INTO dim_restaurant
                (restaurant_key, external_place_id, restaurant_name, operational_status, first_seen_date)
            VALUES (42, 'osm_node_1001', 'Prior Name', 'PERMANENTLY_CLOSED', '2026-01-01');
            INSERT INTO app_user_reviews VALUES (1, 42);
        """)
        conn = Mock()
        cursor = conn.cursor.return_value

        def execute(sql, params=()):
            statement = sql.strip()
            if statement.startswith("INSERT INTO dim_restaurant"):
                statement = statement.replace(
                    "ON DUPLICATE KEY UPDATE",
                    "ON CONFLICT(external_place_id) DO UPDATE SET",
                )
                for field in (
                    "restaurant_name", "street_address", "latitude", "longitude",
                    "zone_key", "primary_cuisine_key", "operational_status", "distance_to_ust_km",
                ):
                    statement = statement.replace(f"VALUES({field})", f"excluded.{field}")
                db.execute(statement.replace("%s", "?"), (*params[:-1], params[-1].isoformat()))
            elif statement.startswith("SELECT restaurant_key FROM dim_restaurant"):
                cursor.fetchone.return_value = db.execute(statement.replace("%s", "?"), params).fetchone()
            elif statement.startswith("SELECT source_key"):
                cursor.fetchone.return_value = {"source_key": 1}
            elif statement.startswith("SELECT platform_key"):
                cursor.fetchone.return_value = {"platform_key": 1}
            elif statement.startswith("SELECT zone_key"):
                cursor.fetchone.return_value = {"zone_key": 1}

        cursor.execute.side_effect = execute
        cursor.fetchall.return_value = [{
            "cuisine_key": 1, "cuisine_name": "Unclassified / Pending Review",
            "avg_prep_baseline_mins": 12,
        }]
        venue = {
            "restaurant_name": "Same Brand", "street_address": "Fixture Street",
            "lat": 14.609, "lng": 120.990, "amenity_raw": "restaurant",
        }
        closed = dict(venue, external_place_id="osm_node_1001", business_status="OPERATIONAL")
        new = dict(venue, external_place_id="osm_way_1001")

        with (
            patch("etl.warehouse_loader.mysql.connector.connect", return_value=conn),
            patch("etl.warehouse_loader.ensure_date_key", return_value=20261123),
            patch("etl.warehouse_loader.upsert_modeled_daily_metrics") as daily,
        ):
            run_etl_pipeline(fetcher=lambda: [closed, new, dict(new)])
            assert [
                tuple(row) for row in db.execute("""
                    SELECT restaurant_key, external_place_id, restaurant_name, operational_status
                    FROM dim_restaurant ORDER BY restaurant_key
                """)
            ] == [
                (42, "osm_node_1001", "Same Brand", "PERMANENTLY_CLOSED"),
                (43, "osm_way_1001", "Same Brand", "OPERATIONAL"),
            ]
            assert [call.args[2] for call in daily.call_args_list] == [42, 43, 43]
            run_etl_pipeline(fetcher=lambda: [closed, new], offline_sha256="fixture")
            assert db.execute("SELECT operational_status FROM dim_restaurant WHERE restaurant_key=42").fetchone()[0] == "PERMANENTLY_CLOSED"

            # Model a separately approved status change. A later import can
            # refresh metadata and must preserve this operator choice as well.
            db.execute("UPDATE dim_restaurant SET operational_status='TEMPORARILY_CLOSED' WHERE restaurant_key=42")
            run_etl_pipeline(fetcher=lambda: [dict(closed, restaurant_name="Updated Name"), new])
            assert [call.args[2] for call in daily.call_args_list] == [42, 43, 43, 42, 43, 42, 43]

        assert db.execute("SELECT COUNT(*) FROM dim_restaurant").fetchone()[0] == 2
        assert tuple(db.execute("""
            SELECT r.restaurant_key, r.external_place_id, r.restaurant_name,
                   r.operational_status, r.first_seen_date
            FROM app_user_reviews u JOIN dim_restaurant r USING (restaurant_key)
            WHERE u.user_review_id = 1
        """).fetchone()) == (42, "osm_node_1001", "Updated Name", "TEMPORARILY_CLOSED", "2026-01-01")
        assert conn.commit.call_count == 3


if __name__ == "__main__":
    unittest.main()
