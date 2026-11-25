"""Install the public seed or migrate an exact compatible warehouse without importing reports."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys

import mysql.connector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from etl.config import database_config

DATA = ROOT / 'data/release'
SCHEMA = 'blueplate_dw'
DIMENSIONS = ('dim_city','dim_date','dim_time','dim_zone','dim_cuisine','dim_platform','dim_data_source','dim_alert_threshold')
HISTORY = ('fact_delivery_performance','fact_cancellation_proxy','fact_restaurant_daily_metrics')
VERSIONED = ('directory_publication_batch','directory_publication_entry','revised_directory_review',
             'bi_model_snapshot','dim_bi_model_version','bi_model_publication','fact_bi_restaurant_scenario')
EXPANDED = ('directory_provenance','confirmed_on','publication_status','osm_opening_hours','bi_scope',
            'guest_reporting_enabled','withdrawn_at','identity_hold')


def require(test, message):
    if not test:
        raise ValueError(message)


def select(db, query, args=()):
    with db.cursor() as cursor:
        cursor.execute(query,args)
        return cursor.fetchall()


def read_seed():
    manifest=json.loads((DATA/'source-manifest.json').read_bytes())
    for file,checksum in manifest['files'].items():
        require(sha256((DATA/file).read_bytes()).hexdigest()==checksum,f'{file} checksum differs')
    seed=json.loads((DATA/'warehouse-seed.json').read_bytes())
    require(set(seed)==set(DIMENSIONS+HISTORY+VERSIONED+('dim_restaurant',)),'Unexpected seed table')
    require(len(seed['dim_restaurant'])==322 and len(seed['fact_bi_restaurant_scenario'])==274,'Seed counts differ')
    audit=seed['bi_model_snapshot'][0]
    audit.update(payload=(DATA/'current-model.json').read_text(),csv_export=(DATA/'current-model.csv').read_bytes())
    require(sha256(audit['payload'].encode()).hexdigest()==audit['snapshot_sha256']
            and sha256(audit['csv_export']).hexdigest()==audit['csv_sha256'],'Audit hashes differ')
    return seed


def sql(db,name):
    with db.cursor() as cursor:
        for result in cursor.execute((ROOT/'database'/name).read_text(),multi=True):
            if result.with_rows:
                result.fetchall()


def insert(db, table, records):
    if not records:
        return
    fields=list(records[0])
    columns=','.join(f'`{name}`' for name in fields)
    marks=','.join(['%s']*len(fields))
    with db.cursor() as cursor:
        cursor.executemany(f'INSERT INTO `{table}`({columns}) VALUES ({marks})',
                           [tuple(row[field] for field in fields) for row in records])


def check_existing(db, seed):
    require(select(db,"SHOW COLUMNS FROM app_user_reviews LIKE 'client_submission_id'"),'Compatible migration 06 required')
    require(select(db,"SHOW FULL TABLES LIKE 'vw_v8_restaurant_daily_signals'"),'Compatible migration 07 required')
    require(not select(db,"SHOW COLUMNS FROM dim_restaurant LIKE 'bi_scope'"),'Directory migration is already present')
    legacy=[{k:v for k,v in row.items() if k not in EXPANDED} for row in seed['dim_restaurant'] if row['bi_scope']=='LEGACY']
    def normalize(value):
        return str(value) if value is not None else None
    def canon(items):
        return sorted(json.dumps([normalize(x) for x in item]) for item in items)
    for table,records in [('dim_restaurant',legacy),*((name,seed[name]) for name in HISTORY)]:
        fields=list(records[0])
        columns=','.join(f'`{name}`' for name in fields)
        observed=select(db,f'SELECT {columns} FROM `{table}`')
        require(canon(observed)==canon([[r[n] for n in fields] for r in records]),
                f'Existing {table} differs from the compatible historical baseline')


def migrate(db, seed, existing):
    if existing:
        db.database=SCHEMA
        check_existing(db,seed)
        before=select(db,'SELECT COUNT(*) FROM app_user_reviews')[0][0]
        db.rollback()
    else:
        require(not select(db,'SHOW DATABASES LIKE %s',(SCHEMA,)),'Fresh schema already exists')
        for name in ('01_create_database_and_dimensions.sql','02_create_fact_tables.sql',
                     '03_create_user_oltp_tables.sql','04_create_bi_views_and_alerts.sql'):
            sql(db,name)
        db.database=SCHEMA
        for table in DIMENSIONS:
            insert(db,table,seed[table])
        insert(db,'dim_restaurant',[{k:v for k,v in row.items() if k not in EXPANDED}
                                    for row in seed['dim_restaurant'] if row['bi_scope']=='LEGACY'])
        for table in HISTORY:
            insert(db,table,seed[table])
        db.commit()
        for name in ('06_v8_oltp_migration.sql','07_v8_daily_analytics_view.sql'):
            sql(db,name)
        before=0
    sql(db,'12_directory_expansion.sql')
    sql(db,'12_reviewed_directory.sql')
    db.start_transaction()
    if existing:
        known={r[0] for r in select(db,'SELECT date_key FROM dim_date')}
        insert(db,'dim_date',[r for r in seed['dim_date'] if r['date_key'] not in known])
    for row in seed['dim_restaurant']:
        if row['bi_scope']=='LEGACY':
            with db.cursor() as cursor:
                assignments=','.join(f'{k}=%s' for k in EXPANDED)
                cursor.execute(f'UPDATE dim_restaurant SET {assignments},updated_at=updated_at WHERE restaurant_key=%s AND external_place_id=%s',
                               [row[k] for k in EXPANDED]+[row['restaurant_key'],row['external_place_id']])
                require(cursor.rowcount==1,'Legacy key differs')
        else:
            insert(db,'dim_restaurant',[row])
    for table in VERSIONED[:3]:
        insert(db,table,seed[table])
    db.commit()
    sql(db,'12_directory_expansion.finalize.sql')
    with db.cursor() as cursor:
        cursor.execute("""CREATE TABLE bi_model_snapshot (
          model_version VARCHAR(64) PRIMARY KEY, snapshot_date DATE NOT NULL,
          cohort_sha256 CHAR(64) NOT NULL, snapshot_sha256 CHAR(64) NOT NULL,
          csv_sha256 CHAR(64) NOT NULL, verified_backup_sha256 CHAR(64) NOT NULL,
          payload JSON NOT NULL,csv_export LONGBLOB NOT NULL,published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB""")
    sql(db,'13_versioned_bi.sql')
    sql(db,'14_unlisted_guest_reports.sql')
    db.start_transaction()
    for table in VERSIONED[3:]:
        insert(db,table,seed[table])
    require(select(db,'SELECT COUNT(*) FROM revised_directory WHERE public_visible AND withdrawn_at IS NULL')==[(274,)],'Directory count differs')
    require(select(db,'SELECT date_key,modeled_venues FROM vw_bi_analytical_date ORDER BY date_key')==[(20261115,123),(20261125,274)],
            'Analytical dates differ')
    require(select(db,"SELECT COUNT(*) FROM dim_restaurant WHERE bi_scope='LEGACY' AND operational_status='OPERATIONAL'")==[(119,)],
            'Historical operating cohort differs')
    require(select(db,'SELECT COUNT(*) FROM app_user_reviews')==[(before,)],'Report count changed')
    db.commit()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',required=True,choices=('fresh','existing'))
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--expected-server-uuid')
    args=parser.parse_args()
    seed=read_seed()
    if not args.apply:
        print('Verified public seed. No database changes requested.')
        return
    if not args.expected_server_uuid:
        parser.error('--apply requires --expected-server-uuid from the approved target')
    config=database_config()
    config.pop('database')
    with mysql.connector.connect(**config) as db:
        db.time_zone='+08:00'
        require(select(db,'SELECT @@server_uuid')[0][0]==args.expected_server_uuid,'Server UUID differs')
        require(select(db,'SELECT @@version')[0][0].startswith('8.0.'),'MySQL 8.0 required')
        db.rollback()
        try:
            migrate(db,seed,args.mode=='existing')
        except BaseException:
            db.rollback()
            raise
    print('Installed 274 current listings and scenario rows, with 119 historical operational venues.')


if __name__=='__main__':
    main()
