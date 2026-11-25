"""Review unlisted delivery reports using a separately authorized MySQL account."""
import argparse
import json
from pathlib import Path
import sys

import mysql.connector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from etl.config import database_config

OUTCOMES = ("MATCHED_EXISTING", "APPROVED_NEW", "DUPLICATE_OR_INVALID", "OUTSIDE_STUDY_AREA")


def resolve(db, report_id, outcome, key=None):
    requires_key = outcome in ("MATCHED_EXISTING", "APPROVED_NEW")
    if outcome not in OUTCOMES or requires_key != (key is not None):
        raise ValueError("Choose a valid outcome and supply a canonical key only for a match or approval.")
    with db.cursor() as cursor:
        if requires_key:
            cursor.execute("""
                SELECT d.bi_scope FROM revised_directory r JOIN dim_restaurant d USING(restaurant_key)
                WHERE r.restaurant_key=%s AND r.public_visible=TRUE AND r.withdrawn_at IS NULL
                AND ST_Distance_Sphere(POINT(d.longitude,d.latitude), POINT(120.9895,14.6091), 6371000)<=1500
                FOR UPDATE
            """, (key,))
            target = cursor.fetchone()
            if target is None or (outcome == "APPROVED_NEW" and target[0] != "DIRECTORY_ONLY"):
                raise ValueError("Use an approved in-boundary canonical venue. New venues must be reviewed and added to the directory separately.")
        cursor.execute("""
            UPDATE app_user_reviews
            SET restaurant_key=%s, restaurant_review_status=%s, restaurant_reviewed_at=NOW()
            WHERE user_review_id=%s AND restaurant_review_status='PENDING'
        """, (key, outcome, report_id))
        if cursor.rowcount != 1:
            raise ValueError("Report was not found or has already been reviewed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-server-uuid", required=True)
    parser.add_argument("--report", type=int, help="Report reference to resolve")
    parser.add_argument("--outcome", choices=OUTCOMES)
    parser.add_argument("--restaurant-key", type=int)
    args = parser.parse_args()
    if (args.report is None) != (args.outcome is None) or (args.report is None and args.restaurant_key is not None):
        parser.error("Use --report and --outcome together, or omit both to list pending entries.")
    config = database_config("MYSQL")
    if config["database"] != "blueplate_dw":
        parser.error("The target schema must be blueplate_dw.")
    with mysql.connector.connect(**config) as db:
        with db.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT @@server_uuid AS uuid")
            if cursor.fetchone()["uuid"] != args.expected_server_uuid:
                parser.error("Target server UUID differs.")
            if args.report is None:
                cursor.execute("""
                    SELECT user_review_id, submitted_restaurant_name, submitted_restaurant_location,
                           submitted_restaurant_type, submitted_location_details, submitted_at
                    FROM app_user_reviews WHERE restaurant_review_status='PENDING'
                    ORDER BY user_review_id LIMIT 100
                """)
                print(json.dumps(cursor.fetchall(), ensure_ascii=True, default=str, indent=2))
                return
        try:
            resolve(db, args.report, args.outcome, args.restaurant_key)
            db.commit()
        except ValueError as error:
            db.rollback()
            parser.error(str(error))
        print(f"Recorded {args.outcome} for report {args.report}.")


if __name__ == "__main__":
    main()
