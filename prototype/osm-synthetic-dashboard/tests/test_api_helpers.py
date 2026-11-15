import unittest
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from web_app_example.api_helpers import (
    ACTION_CATEGORY_MAP, ValidationError, classify, combined_health,
    normalize_json, parse_period, positive_integer, safe_csv,
)


class TestValidation(unittest.TestCase):
    def test_positive_integer(self):
        self.assertEqual(positive_integer("27", "restaurant_key"), 27)
        for value in (0, -2, "1.5", "test", None, True, "002"):
            with self.assertRaises(ValidationError):
                positive_integer(value, "restaurant_key")

    def test_period_parsing(self):
        p = parse_period({"from": "2026-11-01", "to": "2026-11-07"})
        self.assertEqual(p["start_key"], 20261101)
        self.assertEqual(p["end_key"], 20261107)
        self.assertEqual(p["end_exclusive"].isoformat(), "2026-11-08")
        for args in ({"from": "2026-11-09", "to": "2026-11-01"},
                     {"from": "not-a-date", "to": "2026-11-01"},
                     {"from": "2020-01-01", "to": "2023-01-01"}):
            with self.assertRaises(ValidationError):
                parse_period(args)

    def test_thresholds_and_missing_data(self):
        t = {"warning_limit": Decimal("8.00"), "critical_limit": Decimal("15.00")}
        self.assertEqual(classify(14.9, t), "WARNING")
        self.assertEqual(classify(15, t), "CRITICAL")
        self.assertEqual(classify(None, t), "UNKNOWN")
        rules = {
            "DELIVERY_ETA_MINS": {"warning_limit": 35, "critical_limit": 45},
            "CANCELLATION_PROXY_PCT": t,
            "AVG_RATING": {"warning_limit": 4, "critical_limit": 3.6},
        }
        self.assertEqual(combined_health({"public_avg_rating": 4.5}, rules), "UNKNOWN")
        self.assertEqual(combined_health({"public_avg_rating": 4.5,
                                          "cancellation_risk_index": 8.4}, rules), "WARNING")
        self.assertEqual(combined_health({"public_avg_rating": 4.5,
                                          "cancellation_risk_index": 3,
                                          "proxy_delivery_mins": 30}, rules), "NORMAL")

    def test_category_map_exact_frontend_labels(self):
        self.assertEqual(len(ACTION_CATEGORY_MAP), 6)
        self.assertEqual(ACTION_CATEGORY_MAP["General Observation"], "GENERAL_OBSERVATION")
        self.assertEqual(ACTION_CATEGORY_MAP["Delivery Delay"], "DELIVERY_DELAY")

    def test_export_formula_escaping(self):
        out = safe_csv([{"name": "=HYPERLINK(\"bad\")", "eta": Decimal("31.5")},
                        {"name": "España café", "eta": None}], ["name", "eta"])
        self.assertIn("'=HYPERLINK", out)
        self.assertIn("España café", out)
        self.assertIn("31.5", out)

    def test_json_conversion(self):
        self.assertEqual(normalize_json({"value": Decimal("1.5")})["value"], 1.5)


if __name__ == "__main__":
    unittest.main()
