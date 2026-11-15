# BluePlate V8 — Thom integration repair notes

**Basis:** uploaded `BluePlate_V8.zip`. **Scope:** local Flask/MySQL integration, not the GitHub Pages demo or the team's independent Next.js/AWS deployment.

## Fixed

1. Removed the out-of-scope `blueplate:synced` event listener; replaced it with `window.BluePlateApp` callbacks registered within `app.js`.
2. Rewrote `api-bridge.js` to detect the same-origin Flask API via `/api/health`. On a static host, it leaves the explicitly labeled demo alone. On Flask, it loads actual MySQL API JSON and **does not fall back to fabricated metric values** when the DB is empty or inaccessible.
3. Reused the existing Public Portal autocomplete rather than replacing its form with `cloneNode(true)`, which discarded event listeners. Dropdown suggestions are recalculated from current `state.restaurants`, and live submissions use the database `restaurant_key`.
4. Replaced simulated live-mode date history with `/api/dashboard/trends` and per-restaurant `/api/restaurants/<key>` queries. Date preset and custom-range actions refetch server data. The browser displays missing values as unavailable instead of defaulting to prices, star ratings, ETAs or risk scores.
5. CSV restaurant export points to the warehouse API. Auditor-text exports require real manager auth; export is disabled in this browser mode. Manager Action Log, alert acknowledgment, and ETL refresh writes remain read-only in live mode because the frontend does not implement real administrative login.
6. `GET /api/session` no longer reveals a shared manager token. It returns only non-secret feature flags. The optional SQL seed no longer promotes `user_id=1` to `ADMIN`.
7. Sanitized backend-controlled restaurant fields, report comments, alert messages, and data displayed in live frontend HTML. The ZIP contains no `.env`, `.venv`, macOS metadata, or Python cache files.
8. Updated Mac/Windows README to distinguish the Flask local site on port 5000 from the static demo on port 8000, GitHub Pages, and Google Sites.

## Known limitations — do not claim production readiness

- Guest report POSTs are **disabled by default**; `ENABLE_GUEST_REPORTS=true` is for controlled local testing, not public use. Rate limits / abuse prevention and real consent/privacy controls are pending.
- Secure login, session authorization, manager create/edit/delete, alert updates, and ETL refresh UI are intentionally **not available in live browser mode**. Backend's development-only token endpoints require explicit private bearer credentials; do not put those into browser code.
- Thom's Overpass ETL can load modeled daily metrics (including a baseline rating and modeled orders) and fall back to an unverified static venue list. SQL persistence does not make this data observed. Confirm actual data provenance before presenting.
- Date filtering returns rows available within the selected period. Newly loaded restaurant dimension rows may have no observations in older periods, and charts may show gaps rather than fabricated history.
- The `/api/restaurants?limit=100` public picker currently loads a maximum of 100 restaurants. If you grow beyond 100, implement server-side autocomplete pagination/search.
- No real MySQL instance or deployed API was available during automated validation. Database migrations were **not** run, and end-to-end testing with Thom's RDS or MySQL was **not** performed.
- The repo's deployment differs from this Flask application; coordinate with the cloud developer before changing deployment workflows.

## Tests performed

- `node --check frontend/assets/app.js` and `node --check frontend/assets/api-bridge.js` — **pass**.
- `python -m compileall -q etl web_app_example` — **pass**.
- Chromium DOM interaction test using mocked Flask API payloads — **pass** for admin warehouse rows, date-driven re-fetch, restaurant detail, read-only manager state, public autocomplete, user-submission payload, confirmation, and HTML escaping of deliberately untrusted review text.
- No full HTTP browser navigation test was possible because this runtime blocks browser network navigation. The DOM test used in-browser mocked API responses; it does not prove live server connectivity.

## Manual test with Thom

From a safely configured local environment:

```bash
python -m web_app_example.flask_db_connector
```

Open `http://127.0.0.1:5000/api/health`. If it returns healthy, open `http://127.0.0.1:5000/admin/`. Confirm the blue live-data banner, the restaurant names shown by `/api/dashboard/overview?from=YYYY-MM-DD&to=YYYY-MM-DD`, and 7-/30-day date filters. Then open the public portal at `http://127.0.0.1:5000/` and test the database-backed restaurant picker. Use safe dummy reports and a disposable database if testing the POST endpoint. Do **not** use the public GitHub Pages/Google Sites link to test this same-origin local Flask API.
