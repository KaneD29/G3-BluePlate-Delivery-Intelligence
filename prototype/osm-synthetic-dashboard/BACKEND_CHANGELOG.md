# BluePlate V8 — Backend and schema alignment change log

Scope: original local `etl/`, `database/`, `README.md`, `.env.example`, `requirements*.txt`, `web_app_example/`. This pack **does not** include or modify the V8 frontend. It also **does not** modify GitHub, AWS, or a live MySQL database.

## Original files retained unchanged
- `database/01_create_database_and_dimensions.sql`
- `database/02_create_fact_tables.sql`
- `database/03_create_user_oltp_tables.sql`
- `database/04_create_bi_views_and_alerts.sql`
- `database/05_seed_reference_data.sql`
- `etl/proxy_metrics_engine.py`

Those original SQL files are retained for historical compatibility, not a guarantee that the schema is production-ready.

## New SQL scripts
- `database/06_v8_oltp_migration.sql` (**apply once; back up first**): guest reports, idempotency UUID field, Manager Action Log categories/statuses/alert references/updated timestamps, and unclassified cuisine seed.
- `database/07_v8_daily_analytics_view.sql` (re-runnable): recorded historical metrics and nullable delivery/risk signals.
- `database/08_v8_analytics_verification.sql` (read-only): quick schema checks.

## Updated Python ETL
- `etl/config.py`: separate optional `APP_DB_*` configuration while preserving `DB_CONFIG` for ETL.
- `etl/ust_api_collector.py`: rejects missing/unknown merchant coordinates or operational statuses; missing ratings remain `None`; avoids an unused Places reviews field in nearby-search response.
- `etl/warehouse_loader.py`: transaction, run logging, explicit unclassified cuisine for new merchants, actual consecutive-day review-count deltas, no invented ratings or order totals.
- `etl/proxy_metrics_engine.py`: original proxy calculation code preserved; rates/assumptions still need real-world validation.

## Updated Flask API
- `web_app_example/flask_db_connector.py`: local read APIs for restaurant search, date ranges, daily trends, alert feed, details and CSV; validation for optional guest reviews and Manager Action Log CRUD.
- `web_app_example/api_helpers.py`: date-range limits, status classification from seeded SQL thresholds, CSV spreadsheet-formula escaping, JSON date/Decimal serialization.
- Authorization deliberately remains **development-only**. The app has no production identity system; manager requests and guest writes are disabled without explicit local flags. Static `/admin/` is not a protected login page.

## Updated project metadata
- `README.md`: setup, safety warnings, API contracts, data provenance, migration order, deployment discrepancy, tests.
- `.env.example`: local app/ETL DB accounts, demo gate flags; sample placeholders only.
- `requirements.txt`: existing runtime pins preserved; V8 UI does not create a new Python dependency.
- `requirements-dev.txt`: test dependencies.
- `.gitignore`: ignores `.env`, virtualenvs, caches.
- `docs/ORIGINAL_ETL_ARCHITECTURE.md`: archived original readme for provenance.

## Important integration work still outstanding
1. V8 JavaScript still uses sample data/localStorage. Replace those calls with real API requests, map sample IDs to database keys, and handle missing metrics deliberately.
2. Resolve mismatch with the team's GitHub Next.js + data-service deployment before any deployment.
3. Run migration and integration tests on **disposable MySQL 8** with representative data. These scripts have not been executed on MySQL in this environment.
4. Implement production login, session/authorization, rate limits, anti-spam and HTTPS. Do not publish the bearer-token prototype.
5. Decide metric thresholds with team; V8 browser demo uses different hard-coded values from seeded SQL.
6. Period charts reflect warehouse dates if they exist, not synthetic 90-day demo history. Data sparsity is expected.

## Validation recorded
- Python `compileall`: passed.
- `pytest`: 8 passed, 1 skipped; Flask-specific tests skipped because Flask and MySQL Connector were unavailable here.
- No live DB schema migration, Google Places API call, browser-based V8 integration, or production deployment was performed.

## Local frontend + Flask integration repair (following Thom's changes)

See `docs/THOM_V8_INTEGRATION_REPAIR.md`. The local browser bridge now drives the live V8 interface from Flask API responses, not static default data. `/api/session` no longer returns an administrative bearer token. The optional ninth SQL script no longer promotes a fixed user ID to an admin role. Browser manager writes are deliberately disabled until proper sign-in is implemented. The repair has not been tested against a real MySQL database.
