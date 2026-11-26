"""Load an already reviewed, published model into dimensional facts.

The caller verifies the approved artifact, database identity and backup and owns
the transaction. This module performs no collection or modeling.
"""
from datetime import date
from hashlib import sha256
import json

LEGACY_MODEL = 'legacy-osm-daily-v1'
FACT_FIELDS = {
    'distance_m': 'distance_m',
    'distance_zone': 'distance_zone',
    'modeled_eta_low_min': 'eta_low_min',
    'modeled_eta_high_min': 'eta_high_min',
    'eta_stress_index_points': 'transit_stress_points',
    'hypothetical_demand_low': 'demand_low',
    'hypothetical_demand_base': 'demand_base',
    'hypothetical_demand_high': 'demand_high',
    'cancellation_probability': 'cancellation_probability',
    'legacy_distance_cancellation_index_points': 'legacy_comparison_points',
    'overall_delivery_risk': 'overall_delivery_risk',
    'price_provenance': 'price_provenance',
    'observed_meal_price_php': 'observed_price_php',
    'estimated_meal_price_low_php': 'estimated_price_low_php',
    'estimated_meal_price_high_php': 'estimated_price_high_php',
}


def append_published_snapshot(db, raw, expected_sha256):
    if sha256(raw).hexdigest() != expected_sha256:
        raise ValueError('Reviewed model digest differs')
    snapshot = json.loads(raw)
    version = snapshot['version']
    day = date.fromisoformat(snapshot['snapshot_date_manila'])
    date_key = int(day.strftime('%Y%m%d'))
    members = snapshot.pop('restaurants')
    pairs = {(row['external_place_id'], row['restaurant_key']) for row in members}
    with db.cursor() as cursor:
        cursor.execute('SELECT cohort_sha256,snapshot_sha256,snapshot_date,published_at FROM bi_model_snapshot WHERE model_version=%s',(version,))
        audit = cursor.fetchone()
        if not audit or audit[:3] != (snapshot['cohort_sha256'],expected_sha256,day):
            raise ValueError('Published audit record differs')
        cursor.execute('SELECT external_place_id,restaurant_key FROM revised_directory WHERE public_visible AND withdrawn_at IS NULL')
        if len(pairs)!=len(members) or pairs!=set(cursor.fetchall()) or len(members)!=snapshot['counts']['modeled_venues']:
            raise ValueError('Reviewed directory membership differs')
        cursor.execute("""INSERT INTO dim_date(date_key,full_date,day_of_week,day_name,week_of_year,
                    month_num,month_name,quarter_num,year_num,is_weekend) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE date_key=date_key""",
                       (date_key,day,day.isoweekday(),day.strftime('%A'),day.isocalendar().week,day.month,
                        day.strftime('%B'),(day.month-1)//3+1,day.year,day.isoweekday()>=6))
        cursor.execute("""INSERT INTO dim_bi_model_version VALUES
                       (%s,'LEGACY_DAILY','Legacy OSM daily facts'),
                       (%s,'DELIVERY_SCENARIO','Reviewed delivery scenarios and equal allocation')
                       ON DUPLICATE KEY UPDATE model_version=model_version""",(LEGACY_MODEL,version))
        cursor.execute('INSERT INTO bi_model_publication VALUES (%s,%s,%s,%s,%s,%s)',
                       (date_key,version,expected_sha256,version,audit[3],json.dumps(snapshot)))
        columns = ','.join(FACT_FIELDS.values())
        values = ','.join(['%s'] * (len(FACT_FIELDS) + 4))
        cursor.executemany(
            f'INSERT INTO fact_bi_restaurant_scenario(date_key,model_version,restaurant_key,{columns},reviewed_attributes) VALUES ({values})',
            [(date_key,version,row['restaurant_key'],*(row[key] for key in FACT_FIELDS),
              json.dumps({k:v for k,v in row.items() if k not in FACT_FIELDS and k!='restaurant_key'}))
             for row in members])
    return date_key, version, len(members)


def read_scenario_rows(records):
    """Rehydrate the published display contract from typed facts, not audit JSON."""
    return [{**json.loads(row['reviewed_attributes']), 'restaurant_key':row['restaurant_key'],
             **{key:row[column] for key,column in FACT_FIELDS.items()}} for row in records]
