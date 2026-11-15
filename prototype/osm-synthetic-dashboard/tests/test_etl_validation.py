"""Collector/proxy checks run without hitting external services."""
import unittest
from unittest.mock import patch

from etl.proxy_metrics_engine import (
    assign_ust_zone_code, compute_cancellation_proxy, compute_delivery_eta_proxy,
)
from etl.ust_api_collector import fetch_ust_eateries_osm_overpass


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


if __name__ == "__main__":
    unittest.main()