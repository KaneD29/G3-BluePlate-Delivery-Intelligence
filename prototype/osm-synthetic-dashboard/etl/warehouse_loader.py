"""Daily OpenStreetMap Overpass refresh for the BluePlate V8 warehouse (100% free, no API key)."""
from datetime import datetime
from zoneinfo import ZoneInfo
import mysql.connector

from etl.config import DB_CONFIG
from etl.ust_api_collector import fetch_ust_eateries_osm_overpass
from etl.proxy_metrics_engine import build_restaurant_enrichment

MANILA = ZoneInfo("Asia/Manila")


def resolve_cuisine_name(cuisine_raw: str, amenity_raw: str) -> str:
    """Map free OpenStreetMap tags to seeded dim_cuisine categories."""
    raw = f"{cuisine_raw} {amenity_raw}".lower()
    if any(k in raw for k in ("coffee", "cafe", "tea", "bubble", "milktea", "shake", "juice")):
        return "Milktea, Coffee & Shakes"
    if any(k in raw for k in ("burger", "fast_food", "chicken", "fries", "sandwich")):
        return "Fast Food & Burgers"
    if any(k in raw for k in ("korean", "samgyup", "bbq")):
        return "Korean & Samgyupsal Bowls"
    if any(k in raw for k in ("pizza", "pasta", "italian")):
        return "Pizza & Pasta"
    if any(k in raw for k in ("japanese", "ramen", "sushi", "donburi")):
        return "Japanese Ramen & Donburi"
    if any(k in raw for k in ("filipino", "silog", "asian", "rice", "carinderia")):
        return "Silog & Filipino Rice Meals"
    return "Unclassified / Pending Review"


def ensure_date_key(conn, today):
    key = int(today.strftime("%Y%m%d"))
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT IGNORE INTO dim_date (
                date_key, full_date, day_of_week, day_name, week_of_year,
                month_num, month_name, quarter_num, year_num, is_weekend
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (key, today, today.isoweekday(), today.strftime("%A"),
             today.isocalendar().week, today.month, today.strftime("%B"),
             (today.month - 1) // 3 + 1, today.year, today.isoweekday() >= 6),
        )
    finally:
        cur.close()
    return key


def run_etl_pipeline(fetcher=fetch_ust_eateries_osm_overpass, *, offline_sha256=None):
    """Transactional upsert from free OpenStreetMap Overpass data."""
    started = datetime.now(MANILA)
    places = fetcher()
    if not places:
        raise RuntimeError("No venues collected; ETL stopped before database writes")
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = None
    loaded = 0
    try:
        today = started.date()
        date_key = ensure_date_key(conn, today)
        cursor = conn.cursor(dictionary=True)

        source_code = "OSM_OFFLINE" if offline_sha256 else "OSM_OVERPASS"
        if offline_sha256:
            cursor.execute("""INSERT INTO dim_data_source
                (source_code, collection_method, tos_compliance_notes, rate_limit_seconds)
                VALUES ('OSM_OFFLINE', 'Official REST API',
                'Offline OSM extract; © OpenStreetMap contributors; ODbL 1.0; see dataset manifest', 0)
                ON DUPLICATE KEY UPDATE source_code=VALUES(source_code)""")
        cursor.execute("SELECT source_key FROM dim_data_source WHERE source_code = %s", (source_code,))
        source = cursor.fetchone()
        if not source:
            raise RuntimeError("Missing OSM_OVERPASS in dim_data_source; run 05_seed_reference_data.sql")
        source_key = source["source_key"]

        cursor.execute("SELECT platform_key FROM dim_platform WHERE platform_name LIKE %s LIMIT 1", ("%OpenStreetMap%",))
        plat = cursor.fetchone()
        if not plat:
            raise RuntimeError("Missing seeded OpenStreetMap platform")
        platform_key = plat["platform_key"]

        cursor.execute(
            """INSERT IGNORE INTO dim_time (
                time_key, hour_24, minute_of_hour, time_slot_label, meal_period, is_peak_hour
            ) VALUES (1200, 12, 0, '12:00 PM', 'Lunch Rush (11-14)', TRUE)"""
        )

        cursor.execute("SELECT cuisine_key, cuisine_name, avg_prep_baseline_mins FROM dim_cuisine")
        cuisines = {row["cuisine_name"]: row for row in cursor.fetchall()}

        for place in places:
            cuisine_name = resolve_cuisine_name(place.get("cuisine_raw", ""), place.get("amenity_raw", ""))
            cuisine_row = cuisines.get(cuisine_name) or cuisines["Unclassified / Pending Review"]
            cuisine_key = cuisine_row["cuisine_key"]
            place["prep_baseline_mins"] = cuisine_row["avg_prep_baseline_mins"]

            enrich = build_restaurant_enrichment(place, is_peak_hour=True)
            cursor.execute("SELECT zone_key FROM dim_zone WHERE zone_code = %s", (enrich["zone_code"],))
            row = cursor.fetchone()
            if not row:
                raise RuntimeError(f"Missing seeded UST zone {enrich['zone_code']}")
            zone_key = row["zone_key"]

            cursor.execute(
                """INSERT INTO dim_restaurant (
                    external_place_id, restaurant_name, zone_key, primary_cuisine_key,
                    street_address, latitude, longitude, distance_to_ust_km,
                    operational_status, first_seen_date
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                    restaurant_name=VALUES(restaurant_name),
                    street_address=VALUES(street_address),
                    latitude=VALUES(latitude),
                    longitude=VALUES(longitude),
                    zone_key=VALUES(zone_key),
                    primary_cuisine_key=VALUES(primary_cuisine_key),
                    operational_status=VALUES(operational_status),
                    distance_to_ust_km=VALUES(distance_to_ust_km)""",
                (
                    place["external_place_id"], place["restaurant_name"], zone_key,
                    cuisine_key, place["street_address"], place["lat"], place["lng"],
                    enrich["distance_to_ust_km"], place.get("business_status", "OPERATIONAL"), today,
                ),
            )
            cursor.execute(
                "SELECT restaurant_key FROM dim_restaurant WHERE external_place_id = %s",
                (place["external_place_id"],),
            )
            restaurant_key = cursor.fetchone()["restaurant_key"]

            # Legacy NOT NULL rating placeholder, not an observed/public rating.
            # API excludes ratings when total_review_count is zero. Demand is modeled.
            baseline_rating = 4.30
            cursor.execute(
                """INSERT INTO fact_restaurant_daily_metrics (
                    date_key, restaurant_key, zone_key, avg_rating, total_review_count,
                    daily_new_reviews, estimated_order_volume, severity_level
                ) VALUES (%s,%s,%s,%s,0,0,25,'NORMAL')
                ON DUPLICATE KEY UPDATE
                    zone_key=VALUES(zone_key), avg_rating=VALUES(avg_rating)""",
                (date_key, restaurant_key, zone_key, baseline_rating),
            )

            # Delivery ETA proxy fact
            eta_mins = enrich["estimated_total_delivery_mins"]
            road_mins = enrich["road_transit_mins"]
            eta_sev = enrich["delivery_severity"]
            cursor.execute(
                """DELETE FROM fact_delivery_performance
                   WHERE date_key = %s AND restaurant_key = %s AND time_key = 1200
                     AND platform_key = %s AND source_key = %s""",
                (date_key, restaurant_key, platform_key, source_key),
            )
            cursor.execute(
                """INSERT INTO fact_delivery_performance (
                    date_key, time_key, restaurant_key, zone_key, platform_key, source_key,
                    quoted_eta_min_mins, quoted_eta_max_mins, estimated_total_delivery_mins,
                    road_transit_mins, delivery_fee_php, min_order_php, is_sla_compliant, severity_level
                ) VALUES (%s, 1200, %s, %s, %s, %s, %s, %s, %s, %s, 49.00, 99.00, %s, %s)""",
                (
                    date_key, restaurant_key, zone_key, platform_key, source_key,
                    max(10, int(eta_mins - 4)), int(eta_mins + 5), eta_mins,
                    road_mins, eta_mins <= 35.0, eta_sev,
                ),
            )

            # Cancellation risk proxy fact
            cpi = round(2.5 + (enrich["distance_to_ust_km"] * 2.2), 2)
            cpi_sev = "CRITICAL" if cpi >= 15.0 else "WARNING" if cpi >= 8.0 else "NORMAL"
            cursor.execute(
                """INSERT INTO fact_cancellation_proxy (
                    date_key, restaurant_key, zone_key, unexpected_offline_flips,
                    out_of_stock_item_ratio, cancellation_review_mentions,
                    cancellation_proxy_rate_pct, severity_level
                ) VALUES (%s, %s, %s, 0, 5.0, 0, %s, %s)
                ON DUPLICATE KEY UPDATE
                    zone_key=VALUES(zone_key),
                    cancellation_proxy_rate_pct=VALUES(cancellation_proxy_rate_pct),
                    severity_level=VALUES(severity_level)""",
                (date_key, restaurant_key, zone_key, cpi, cpi_sev),
            )
            loaded += 1

        finished = datetime.now(MANILA)
        cursor.execute(
            """INSERT INTO fact_etl_pipeline_runs (
                date_key, source_key, started_at, finished_at,
                records_extracted, records_loaded, error_count, run_status, log_summary
            ) VALUES (%s,%s,%s,%s,%s,%s,0,'SUCCESS',%s)""",
            (
                date_key, source_key, started.replace(tzinfo=None),
                finished.replace(tzinfo=None), len(places), loaded,
                ("Offline OSM SHA256=" + offline_sha256 + "; ODbL; modeled demand/ETA/risk/fees; 4.30 placeholder excluded by API") if offline_sha256 else "Live OSM venues; modeled demand/ETA/risk/fees; rating placeholder excluded by API",
            ),
        )
        conn.commit()
        print(f"[BluePlate ETL] Loaded {loaded}/{len(places)} UST eateries from OpenStreetMap ({source_code}).")
        return {"extracted": len(places), "loaded": loaded}
    except Exception:
        conn.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        conn.close()


if __name__ == "__main__":
    import argparse
    import json
    parser = argparse.ArgumentParser(description="BluePlate live OSM or validated offline OSM import")
    parser.add_argument('--offline-osm', help='OSM JSON extract; requires a .manifest.json sidecar')
    parser.add_argument('--manifest', help='Explicit provenance manifest path')
    parser.add_argument('--validate-only', action='store_true', help='Validate offline data without DB or network')
    args = parser.parse_args()
    if (args.manifest or args.validate_only) and not args.offline_osm:
        parser.error('--manifest/--validate-only require --offline-osm')
    if args.offline_osm:
        from etl.offline_osm import load_offline_osm
        places, metadata = load_offline_osm(args.offline_osm, args.manifest)
        print(json.dumps(metadata, indent=2))
        if not args.validate_only:
            import os
            if os.getenv('BLUEPLATE_ENV', 'development') != 'development' or (
                DB_CONFIG['host'], DB_CONFIG['port'], DB_CONFIG['database'], DB_CONFIG['user']
            ) != ('127.0.0.1', 3307, 'blueplate_dw', 'blueplate_etl'):
                raise RuntimeError('Offline import restricted to the confirmed local development database')
            run_etl_pipeline(fetcher=lambda: places, offline_sha256=metadata['sha256'])
    else:
        run_etl_pipeline()