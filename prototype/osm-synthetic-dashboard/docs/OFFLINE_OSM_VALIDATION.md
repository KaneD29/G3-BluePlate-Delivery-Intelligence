# BluePlate offline OSM import validation

Validated 15 November 2026 (Asia/Manila). **116 actual OSM venue records imported successfully** into the existing local development database. A second sequential run left venue and daily fact counts unchanged. No schema changes, synthetic venue fallback, archived-file changes, or production deployment.

## Dataset and provenance

The original JSON was downloaded directly from the [official OpenStreetMap map API](https://api.openstreetmap.org/api/0.6/map.json?bbox=120.985,14.605,120.995,14.615), following its [bounding-box export interface](https://wiki.openstreetmap.org/wiki/API_v0.6). Retrieved at 13:16:13 Manila time on 15 November 2026.

- Attribution: © OpenStreetMap contributors.
- [Copyright and attribution](https://www.openstreetmap.org/copyright); [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Original extract: `data/osm/ust-osm.json` in the active working project.
- Sidecar: `data/osm/ust-osm.manifest.json` includes original source URL, retrieval timestamp, SHA-256, attribution, and license.
- SHA-256: `3e9683d7895a12f04acf52b000eaca635975a31d6dbdec0f1b1c891596e73a5e`.
- Export bbox: west 120.985, south 14.605, east 120.995, north 14.615. This is a campus-area snapshot, **not complete coverage of the whole 1.5 km circle**.
- 17,469 OSM elements processed; 116 eligible named restaurant/fast-food/café nodes accepted, 17,353 elements excluded. Ways, relations, other amenities and unnamed venues are excluded. Their coordinates are never fabricated.

This is genuine OSM source data, not verification that every business is currently operating. The existing warehouse operational-status convention and cuisine/zone classification are inherited approximations. Missing street addresses are labeled “Address not recorded in OSM.”

## Validation and duplicate policy

Before any database connection, the offline loader verifies the manifest/checksum, attribution/license, timestamp, approved original source host, JSON structure, positive integer OSM IDs, element types, tags, required nonblank venue names, schema field lengths, finite numeric coordinates and geographic ranges. Venue records must be within 1.5 km of the configured UST center.

Identical repeats of one OSM type/ID are collapsed; conflicting repeats abort the entire import. No malformed venue is silently converted into a synthetic venue. Different OSM IDs are retained as separate source records; names alone are not sufficient to merge branches.

**One possible duplicate business pair is flagged for review:** Callows Burger, `osm_node_4262163137` and `osm_node_4580489293`, same normalized name within 30 meters. Both are genuine distinct OSM records. They remain separate rather than deleting or arbitrarily merging source data. Accordingly, 116 is the number of imported venue records, not a verified count of distinct physical businesses. Future validation prints `possible_same_venue_pairs`.

A checksum detects accidental changes; it is not a digital signature or proof that an independently supplied manifest is trustworthy. Retain the original official download and manifest together.

## Import behavior

The original `python -m etl.warehouse_loader` live mode remains available and still stops when Overpass fails. Offline mode never calls Overpass and never falls back to fabricated records. No new dependencies are required.

Offline imports are restricted to development mode and `127.0.0.1:3307`, `blueplate_dw`, `blueplate_etl`. The existing transaction/upsert loader is reused. An `OSM_OFFLINE` row is added to the existing `dim_data_source` table; no table or view definition changes. Delivery facts reference that source and each run log records the full dataset checksum and modeled-metric warning. Existing external OSM IDs remain the restaurant natural keys.

Run ETL sequentially. Concurrent runs are not supported by the existing delivery table's constraints. A new-day import adds today's modeled snapshot; it does not establish a new real-world observation or refresh the frozen OSM dataset. Switching between live/offline modes may retain delivery estimates for both source keys; review source selection if mixing modes.

## Local database and API evidence

Server: MySQL 8.0.46, port 3307, `blueplate_dw`, `blueplate_etl@127.0.0.1`.

| Check after two imports | Result |
|---|---:|
| Restaurant records | 116 |
| Daily metric rows | 116 |
| Delivery estimate rows | 116 |
| Cancellation proxy rows | 116 |
| V8 daily analytical-view rows | 116 |
| Successful run logs | 2 |
| Duplicate ID/fact groups | 0 |
| Public directory pages | 100 + 16 |
| Admin overview records | 116 |

All imported external IDs matched the accepted extract IDs. Both logs recorded 116 extracted and 116 loaded. Source checksum matches the manifest. Full machine-readable evidence is saved in `results.json` beside this report.

36 applicable automated checks passed, including invalid IDs, NaN/missing/out-of-range coordinates, overlong names, missing names, checksum mismatch, conflicting duplicates, identical duplicates, out-of-area venues, and original API/fallback guards. One source-package-only test was excluded because an installed project legitimately contains `.env` and `.venv`.

Browser verification confirmed:

- User portal: 116 database restaurants and OSM attribution. Searching “Tiger” returned Purple TigerX Cafe, Tiger Café and Tiger Winx from the imported dataset.
- Admin dashboard: 116 restaurants, one dated trend record, zero recorded alerts, and an explicit “BI values are modeled estimates” notice. The directory rendered imported names/addresses and unavailable ratings.
- Public directory pagination was added so the original 100-record limit no longer hides the final 16 venues.

The existing guest-submission and manager-action settings were preserved. No fabricated user reports or alert events were inserted.

## Modeled values and limitations

Names, coordinates and available address/cuisine tags come from OSM. Demand (25 per venue/day), ETA, cancellation risk and fee assumptions remain model estimates. The daily modeled demand total is 2,900; it is **not observed orders**. The tested trend mean was 15.64 modeled minutes and a 3.36 risk index.

The unchanged schema requires the existing 4.30 rating placeholder. Public API overview/trends/detail/export suppress it when review count is zero; the dashboard correctly displays no rating. Raw warehouse views still expose that legacy placeholder and require `total_review_count > 0` filtering for meaningful ratings. No historical transactions or real reviews were invented.

## Exact commands

Use the active working project:

```sh
cd '/Users/zmpnsln/Documents/BI/BI Capstone/Active BluePlate/01 Working Project/blueplate_delivery_intelligence_working'
source .venv/bin/activate
```

Validate the saved extract without network access or database writes:

```sh
python -m etl.warehouse_loader --offline-osm data/osm/ust-osm.json --validate-only
```

Import offline into the configured local database:

```sh
python -m etl.warehouse_loader --offline-osm data/osm/ust-osm.json
```

The adjacent `.manifest.json` is located automatically. For a separately named manifest:

```sh
python -m etl.warehouse_loader --offline-osm data/osm/ust-osm.json --manifest data/osm/ust-osm.manifest.json
```

Run the checks:

```sh
python -m pytest -q
```

Flask is already running on localhost port 5001. If it stops, start it with:

```sh
FLASK_PORT=5001 FLASK_DEBUG=false python -m web_app_example.flask_db_connector
```

Open [User portal](http://127.0.0.1:5001/) or [Admin dashboard](http://127.0.0.1:5001/admin/). Use a reporting period including the import date. After changing server code, restart Flask; after changing browser assets, refresh the page.

## Files

Implemented in `etl/offline_osm.py`, `etl/warehouse_loader.py`, `web_app_example/flask_db_connector.py`, `frontend/assets/api-bridge.js`, `frontend/assets/app.js`, and `tests/test_offline_osm.py`. The extract/manifest are in `data/osm/`; this report is also installed as `docs/OFFLINE_OSM_VALIDATION.md`. Original edited-file copies are preserved in the task's `blueplate-offline/before/` folder. Archived directories and synced project sources were not modified.
