# BluePlate Delivery Intelligence — Local ETL / MySQL / Flask (V8 alignment)

BluePlate is a UST Manila restaurant-delivery **business-intelligence course prototype**. This package updates the *original* Python ETL, MySQL warehouse, and example Flask API for the locally developed **BluePlate Frontend V8**.

> **Status: repaired local integration, not production deployment.** Thom's V8 code and this repair include `frontend/assets/api-bridge.js`. When the page is served from **local Flask on port 5000**, it requests MySQL-backed restaurants, dated overview/alerts/trends, and recent auditor reports. When served from Python's static server, GitHub Pages, or Google Sites, the same frontend remains a **clearly labeled static demo**. The team's separately deployed Next.js/MySQL service is a different architecture. Do not merge this project into its deployment workflow without review. Manager API writes remain disabled in the live browser interface until real authentication is implemented.

## Components and roles

| Component | Directory | Role |
| :---- | :---- | :---- |
| Public Auditor Portal | `frontend/` (add your V8 frontend separately) | Student feedback; browser-only until API integration |
| Admin BI Dashboard | `frontend/admin/` | KPIs, dated analysis, CSV export, alerts, Manager Action Log |
| Flask example API | `web_app_example/` | Parameterized read endpoints and gated write endpoints |
| MySQL 8.0+ | `database/` | Dimension/fact tables, app tables, period views |
| ETL pipeline | `etl/` | OSM Overpass restaurant discovery; separately modeled estimates |

The `database/01...05...` files are the original schema and seed scripts. They are retained without destructive rewrites. The new `database/06...` file is an **apply-once additive migration**, and `07...` adds a re-runnable daily analytical view. Run `08...` for read-only verification.

## Important data distinctions

- **Observed**: collected public directory ratings/review counts and explicitly submitted auditor ratings/delivery times. User reports are self-reported, not independently verified. The API also calculates a clearly derived `blended_rating` (65% public \+ 35% auditor if both exist); the weighting is a demonstration assumption.  
- **Modeled / seeded**: Thom's revised ETL inserts baseline `4.30` restaurant ratings, `25` modeled orders per day, computed delivery estimates, and risk indicators. These values are **synthetic assumptions**, not observed sales, delivery records, or cancellation rates. Data loaded into SQL remains modeled even when retrieved live from MySQL.  
- **Not available unless separately ingested:** Verified deliveries, cancellations, and actual order volumes. The repaired frontend displays unavailable database fields as `—` rather than substituting a fixed price, rating, risk, or ETA. Historical frontend charts use only dates returned by the database; no browser-generated history is added in live mode.  
- **Statuses**: the API follows `dim_alert_threshold` from SQL seed (delivery warning 35/critical 45, risk warning 8/critical 15, rating warning below 4.0/critical below 3.6). These differ from some hardcoded V8 *demo UI* thresholds and must be unified when the frontend is connected.  
- **Collector provenance:** `etl/ust_api_collector.py` was changed by Thom to OSM Overpass with a hardcoded fallback restaurant list if upstream requests fail. That fallback has **not been independently verified**; do not describe fallback IDs or venue details as confirmed OSM observations. Review OSM/Overpass usage conditions before refreshing. The `GOOGLE_PLACES_API_KEY` field is a legacy config entry, not required for the current Overpass collector.

## Setup on macOS and Windows (VS Code)

These instructions cover the **local source package**. They do not deploy the team's existing Next.js/AWS application. The V8 frontend connects to the same-origin Flask endpoints when served from Flask. A standalone static server remains demo-only.

### Prerequisites (both systems)

- **Python 3.11 or newer** (confirm with `python3 --version` on macOS or `py -3 --version` on Windows). On Windows, install Python with its launcher, and allow the installer to add Python to your PATH if offered.  
- **MySQL 8.0 or newer**, with a local server running and an account allowed to set up this *development* schema. MySQL Workbench is optional but useful for executing and reviewing the SQL files.  
- **Visual Studio Code** (or another editor), and a terminal application: Terminal/zsh on macOS, PowerShell on Windows.  
- The **BluePlate V8 `frontend/` folder**, which is distributed separately from this backend alignment package. Place `frontend/` beside `etl/`, `database/`, and `web_app_example/`.

Open `blueplate_delivery_intelligence` in VS Code, then open **Terminal → New Terminal**. All commands below start at the **project root**, except where `cd frontend` is shown. Do not run these commands inside `assets/` or `admin/`.

### A. macOS — create and activate the Python environment

In macOS Terminal or VS Code's integrated terminal:

```sh
cd /path/to/blueplate_delivery_intelligence
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Replace `/path/to/blueplate_delivery_intelligence` with the folder on your Mac. The commands above use `python` **after** activation; it refers to the virtual environment's interpreter. Edit `.env` with **your own local MySQL accounts and credentials** and leave real credentials out of Git.

### B. Windows — create and activate the Python environment

In VS Code's **PowerShell** terminal:

```powershell
cd C:\path\to\blueplate_delivery_intelligence
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

&nbsp;

Replace `C:\path\to\blueplate_delivery_intelligence` with the real folder on your PC. If PowerShell restricts script activation, **do not disable system security policies globally**. Instead open a **Command Prompt (cmd)** terminal in VS Code, and use:

```bat
.venv\Scripts\activate.bat
python -m pip install -r requirements.txt
copy .env.example .env
```

&nbsp;

This assumes you already created `.venv` with `py -3 -m venv .venv` from the project root. If `py` is unavailable, check your Python installation/launcher rather than assuming Python is installed. Edit `.env` with your **own local MySQL accounts and credentials**; never commit it.

### C. MySQL setup (both systems)

Start your local MySQL server first (the service-starting steps differ depending on whether MySQL was installed via a vendor installer, Homebrew, or Windows Services). Open **MySQL Workbench** or a MySQL client and run the following files **in order, only on a new empty local development schema**:

```
database/01_create_database_and_dimensions.sql
database/02_create_fact_tables.sql
database/03_create_user_oltp_tables.sql
database/04_create_bi_views_and_alerts.sql
database/05_seed_reference_data.sql
database/06_v8_oltp_migration.sql
database/07_v8_daily_analytics_view.sql
database/08_v8_analytics_verification.sql   (read-only checks)
```

Before testing the API, confirm the MySQL host, port, database and account values in `.env` actually match what you created. The SQL seed reference data does **not** automatically mean that real restaurant performance observations are populated.

**If the database already exists:** back it up and review its current schema first. Do **not** indiscriminately rerun `01–05`. Apply `06` **only once** if not already applied (it is not idempotent), then review/run `07` and execute the read-only checks in `08`. Never apply these local migration files directly to your group's shared AWS/RDS database. The AWS migration process requires separately reviewed migration/verification pairs.

### D. Start the Flask example API (both systems)

Make sure the virtual environment is active in the terminal at the project root. Start Flask:

```sh
python -m web_app_example.flask_db_connector
```

Visit [**http\://127.0.0.1:5000/api/health**](http://127.0.0.1:5000/api/health) in your browser. This is a basic API health endpoint, **not** a guarantee that MySQL connections or migrations are successful. Other API endpoints require the configured database, schema, and relevant data.

When `frontend/` is in the same project root, the Flask example can also serve [**http\://127.0.0.1:5000/**](http://127.0.0.1:5000/) and [**http\://127.0.0.1:5000/admin/**](http://127.0.0.1:5000/admin/) for local inspection. These pages **attempt live local data requests** through `/api/health`, `/api/session`, `/api/restaurants`, `/api/dashboard/overview`, `/api/dashboard/trends`, and `/api/dashboard/alerts`. The dashboard will show a visible warehouse-error banner and **hide sample metrics** if a configured Flask API cannot reach MySQL. Start a fresh Flask process after making code/config changes. The Admin HTML is **not protected by an admin login**; access is intended only for your own loopback computer.

### E. Run the V8 frontend independently (macOS or Windows)

This is the simplest way to view the **static prototype** without starting Flask or setting up MySQL. Open a **second VS Code terminal** in the project root. Then use the command for your OS:

**macOS:**

```sh
cd frontend
python3 -m http.server 8000
```

**Windows (PowerShell or cmd):**

```powershell
cd frontend
py -3 -m http.server 8000
```

&nbsp;

If Python is installed but the Windows `py` launcher is unavailable, use `python -m http.server 8000` with a working Python installation.

Open these URLs on **either** operating system:

| Page | Local URL |
| :---- | :---- |
| Public Auditor Portal | [http\://localhost:8000/](http://localhost:8000/) |
| Admin BI Dashboard | [http\://localhost:8000/admin/](http://localhost:8000/admin/) |

Keep the terminal running while browsing. Press **Ctrl+C** inside that terminal to stop the server. To refresh updated HTML/CSS/JS, first save files, then refresh your browser; a force reload can help with cached assets. The static Python server does **not** connect the frontend to MySQL or implement API authentication.

### F. Optional ETL and validation (both systems)

Run the following from the **project root** with the Python virtual environment active and a configured local MySQL schema:

```sh
python -m etl.warehouse_loader
```

The collector now requests restaurants through the **OpenStreetMap Overpass API**, not Google Places. It does not need a Google key, but it relies on public Overpass services that may be unavailable or rate limited. If all mirrors fail or return no usable venues, the collector stops **before database writes**. Synthetic venue fallback is disabled. Venue names and coordinates come from live OSM responses; demand (25 per restaurant/day), delivery time, fees, and cancellation risk are **modeled assumptions**, not observed transactions. The legacy schema requires a 4.30 rating placeholder; all live Flask rating responses and exports exclude it while review count is zero. Raw SQL views still expose that placeholder and must not be interpreted as public ratings. Test only on a disposable development schema. The existing collector query covers named nodes within 1,000 meters (the radius setting is not currently used).

To run Python checks:

```sh
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m compileall -q etl web_app_example
```

These are local code checks, **not** MySQL migration tests or V8 frontend-to-API integration tests.

### G. Read the frontend changelog on macOS and Windows

When `FRONTEND_CHANGELOG.md` is available in the project root, open it in VS Code. Use the Markdown preview shortcut to see formatted headings and tables:

| Platform | VS Code Markdown preview |
| :---- | :---- |
| macOS | **Command (⌘) \+ Shift \+ V** |
| Windows | **Ctrl \+ Shift \+ V** |

Alternatively, GitHub renders `.md` files directly in the browser once they're committed to the repository. A `.md` file can also be opened as plain text in TextEdit (macOS) or Notepad (Windows), but the Markdown formatting won't be rendered.

### Common troubleshooting

- **"Connection refused" at port 8000:** the static server is not running, or you started it from the wrong folder. Run it **inside `frontend/`**.  
- **Port 8000 already in use:** stop the earlier local server with Ctrl+C rather than starting several copies.  
- **Unstyled page using `file://`:** use `http://localhost:8000/` instead of double-clicking `index.html`; verify the `assets/` folder is beside `admin/` and the public `index.html`.  
- **Flask is running but pages still show demo figures:** this is expected until V8 `app.js` calls the real API endpoints.  
- **MySQL access denied / missing tables:** confirm local `.env`, database privileges, and migration status. Do not "fix" a shared database by rerunning schema scripts.  
- **Missing `FRONTEND_CHANGELOG.md`:** it is a separately prepared documentation file; add it to the project root if you want teammates to read it locally.

The existing Admin HTML route **is not secure**. The `/api/session` response does **not** send a manager token to visitors. Browser-based Action Log edits, alert acknowledgement, and ETL-triggering writes are disabled in live mode until real manager authentication exists. Do not expose the Flask server, manager tokens, or write endpoints publicly. Local manager API endpoints require a deliberately enabled development-only token and a real active manager account row; production requests are rejected regardless of the environment token.

## API (local integration contracts)

| Method | Endpoint | Notes |
| :---- | :---- | :---- |
| GET | `/api/health` | Basic API health; no DB probe |
| GET | `/api/session` | Feature flags only; never returns a manager secret |
| GET | `/api/user/reviews?limit=12` | Recent guest reports for the public portal |
| GET | `/api/restaurants?q=...&limit=20` | Search actual DB restaurants; different IDs from sample JS |
| GET | `/api/dashboard/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` | Dated restaurant rollup, no fabricated metrics |
| GET | `/api/dashboard/trends?from=...&to=...` | Historical dates only if records exist |
| GET | `/api/restaurants/<restaurant_key>?from=...&to=...` | Details and actual dated facts |
| GET | `/api/dashboard/alerts?severity=ALL` | Recorded warehouse alerts, not sample alerts |
| GET | `/api/exports/restaurants.csv?from=...&to=...` | CSV for actual warehouse records |
| GET | `/api/exports/reports.csv?from=...&to=...` | Requires manager access; self-reported text |
| POST | `/api/user/reviews` | Guest reviews: **disabled by default**, anti-abuse controls needed |
| GET/POST | `/api/manager/actions` | Requires development manager token; GET can filter by `status`, `category`, and `q` |
| PATCH/DELETE | `/api/manager/actions/<annotation_id>` | Requires development manager token |

A missing `from`/`to` means the past **7 local Manila calendar days**, inclusive. Maximum window is 366 days; future dates are rejected. API fields use SQL-native `restaurant_key`, `zone_key`, `alert_id`, and categories/status codes. Do not send sample-data IDs or modeled alert strings as database foreign keys.

### Example: report payload for local test

Set `ENABLE_GUEST_REPORTS=true` in `.env` **for local testing only**, restart Flask, then:

```sh
curl -X POST http://127.0.0.1:5000/api/user/reviews \
  -H 'Content-Type: application/json' \
  -d '{"restaurant_key": 1, "rating_score": 5, "order_was_cancelled": false, "actual_observed_delivery_mins": 28, "comment_text": "Gate pickup was easy"}'
```

Use a **real restaurant\_key** returned by `/api/restaurants`, not hardcoded `1` unless it exists. The API never accepts `user_id` from a guest. A canceled review requires `null` minutes.

### Example: manager action (development-only)

Create a local active `app_users` row with a properly hashed password for management (no authentication flow is built yet), set `MANAGER_USER_ID` to that record's ID, set `ENABLE_DEMO_MANAGER_TOKEN=true`, and set a random `MANAGER_API_TOKEN` with at least 24 characters. Never copy the token into JavaScript or commit it.

```sh
curl -X POST http://127.0.0.1:5000/api/manager/actions \
  -H "Authorization: Bearer $MANAGER_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"zone_key": 1, "category": "Delivery Delay", "status": "OPEN", "text": "Investigate delayed campus pickup"}'
```

Use a real `zone_key`, and optionally `restaurant_key` or a real fact alert ID. The action log can store a linked alert, but changing an action status never changes the alert's resolution. Model-generated V8 alerts cannot be linked as real foreign keys.

## ETL changes in this update

- Respects Manila's reporting date; avoids treating missing coordinates as the UST campus center.  
- Tracks actual daily **review count delta** only when the preceding calendar day's snapshot exists; demand is explicitly a proxy, not observed orders. A first snapshot or collection gap cannot establish a daily delta and is represented as 0 in the original non-nullable schema.  
- Uses an `Unclassified / Pending Review` cuisine rather than forcing every collected business into the Filipino cuisine dimension. Classification must be researched separately.  
- Records a successful ETL run in `fact_etl_pipeline_runs`; uses a single transaction and rolls back if a required lookup fails.  
- Does **not** manufacture deliveries, platform cancellation rates, historical order counts, or missing public ratings.

## Tests

```sh
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m compileall -q etl web_app_example
```

These checks exercise pure validation and endpoint contracts with mocks. They are **not** a real MySQL migration test or an end-to-end V8 frontend integration test. Test the migration against a disposable MySQL 8.x database before merging.

## Collaboration and deployment notes

1. Merge this folder into your local project **after backing up existing files**. Do not replace the V8 `frontend/` folder; it is intentionally not included.  
2. Give the team both this backend alignment ZIP and the latest V8 frontend ZIP for review.  
3. Decide whether to integrate these Flask endpoints or adapt the V8 feature contracts to the existing **Next.js \+ MySQL-backed service** documented in the team's GitHub `DEPLOYMENT.md`.  
4. Review database migrations, service accounts, feature flags, and real test results with the database/cloud developer before committing to `main`.  
5. Add real login/authorization, abuse prevention, production WSGI hosting, HTTPS, centralized storage, and monitoring before public deployment.

The original architecture write-up is preserved at [`docs/ORIGINAL_ETL_ARCHITECTURE.md`](http://docs/ORIGINAL_ETL_ARCHITECTURE.md) for provenance and source assumptions.

## Thom V8 local integration repair (November 2026)

The maintained repaired files are `frontend/assets/app.js`, `frontend/assets/api-bridge.js`, `frontend/index.html`, `frontend/admin/index.html`, `frontend/assets/style.css`, `web_app_example/flask_db_connector.py`, and an optional safe version of `database/09_v8_live_connection_seed.sql`.

1. The former `blueplate:synced` listener outside the JavaScript scope was removed. The bridge now calls **`window.BluePlateApp`**, a small explicit interface registered inside `app.js`.
2. Live Auditor Portal search now uses the database's `restaurant_key` values; the existing form and autocomplete event handlers are preserved, not cloned away. Reports are submitted to Flask only if `ENABLE_GUEST_REPORTS=true` and development conditions allow it.
3. Admin date presets fetch fresh `/api/dashboard/overview`, `/api/dashboard/alerts`, and `/api/dashboard/trends` responses; restaurant detail dialogs fetch `/api/restaurants/<key>` for the current period. Empty/missing values are shown as unavailable.
4. The Action Log and alert writes remain **read-only in live mode**, instead of silently saving to localStorage. `GET /api/session` no longer exposes `MANAGER_API_TOKEN`.
5. The optional `database/09_v8_live_connection_seed.sql` **never creates or promotes a privileged user**. The old `INSERT ... user_id=1 ON DUPLICATE KEY UPDATE role='ADMIN'` has been removed.
6. ZIP excludes `.env`, `.venv`, caches and macOS metadata. You must create your own `.env` from `.env.example` in your local workspace; never send a real `.env` to groupmates.

**Local integration test:** run `python -m web_app_example.flask_db_connector` from the project root and open `http://127.0.0.1:5000/admin/`. Check `/api/dashboard/overview` using dated query parameters. Then change 7 days to 30 days: the Network panel should show new overview, trend, and alert requests. Open `http://127.0.0.1:5000/` and search a real database restaurant. If guest reports are disabled, the submit control will remain disabled rather than writing fake local records.

See `docs/THOM_V8_INTEGRATION_REPAIR.md` for the repair details and validation boundaries. **The real MySQL schema and the user's local Flask deployment have not been exercised by the automated tests in this environment.** Do not overwrite the already deployed Next.js project with this local Flask pack without agreement from the cloud developer.


### Local validation on MySQL 8 / port 3307

Keep the working `MYSQL_*` settings; `APP_DB_*` may fall back to them for this local test.
Run `python -m etl.warehouse_loader` from this directory with the virtual environment active.
A successful run writes today's Manila date only. Sequential same-day reruns upsert venue/daily/risk records and replace only this OSM source/platform's noon delivery estimate; each successful run appends a run log. Do not run overlapping ETL jobs. Errors roll back the transaction; failed runs are not persisted as success logs.

If macOS occupies port 5000, start `FLASK_PORT=5001 python -m web_app_example.flask_db_connector`, then open `http://127.0.0.1:5001/` and `/admin/`. Use a date range including the load date. No historical transactions are generated. Zero auditor reports and alerts are expected until actual reports/alert events exist.

For checks inside the configured working folder, use `python -m pytest -q -k 'not test_private_env_not_in_source_bundle'`. That one packaging-only check expects `.env` and `.venv` to be absent from a distributable bundle; those files are expected in a working installation.

The first Overpass mirror uses the current [Private.coffee address listed by OpenStreetMap](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances), replacing the old Kumi address.


### Offline OSM import (local development)

A genuine attributed UST OSM snapshot is bundled in `data/osm/`. Run without internet:

```sh
python -m etl.warehouse_loader --offline-osm data/osm/ust-osm.json --validate-only
python -m etl.warehouse_loader --offline-osm data/osm/ust-osm.json
```

The sidecar manifest is required and checksum-checked. No synthetic fallback. Imports are restricted to the configured local development database on port 3307. See [offline validation, provenance, limitations, and exact commands](docs/OFFLINE_OSM_VALIDATION.md).
