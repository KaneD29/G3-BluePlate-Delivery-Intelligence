BLUEPLATE — OSM-ONLY SYNTHETIC DASHBOARD DEMO
============================================

Purpose
-------
Fill the OSM-only BluePlate dashboard with explicitly simulated delivery ETA,
risk index, customer rating, synthetic health class, demand trends, alerts,
and sample reports, while keeping real restaurant identities from MySQL.
The overlay is local to the browser; the original dim_restaurant, review,
alert, action, and fact tables are NOT modified.

The report form works as a BROWSER-ONLY PRACTICE FORM. The Manager Action Log
can create/edit/resolve/delete BROWSER-LOCAL DEMO actions. Neither is a
production audit system. Real MySQL review writes and authenticated manager
endpoints remain disabled. Sample reports are clearly labeled SYNTHETIC.

Setup
-----
The release already includes the demo assets and launcher. Follow README.md
for the local Flask/MySQL setup before running the demo.

Run
---
Stop any other Flask server on port 5001, then:
  bash RUN_BLUEPLATE_SYNTHETIC_DEMO.command

It sets ENABLE_SYNTHETIC_DEMO=true for this LOCAL Flask process only,
BLUEPLATE_ENV=development, and binds the server to 127.0.0.1.
Visit http://127.0.0.1:5001/admin/ and http://127.0.0.1:5001/ .
Hard-refresh both pages (Cmd + Shift + R).

Expected
--------
- Same active OSM restaurant identities/count as your database (119 earlier).
- Synthetic ratings, ETA, risk, health and 7/30/90-day trends displayed.
- 6 fabricated sample reports shown on the public portal.
- Practice public reports stored only in THIS BROWSER's localStorage.
- Manager Action Log works locally (browser-only) with demo actions/notes.
- Downloadable demo reports CSV clearly marked as synthetic.
- Every demo panel is explicitly marked SYNTHETIC / DEMO.
- Overture remains archived/unpublished; no MySQL inserts or migrations.

Important: No login is added here. The local admin page has no robust access
control and MUST NOT be publicly deployed this way. Before cloud deployment:
implement real admin accounts, server-side sessions, CSRF protection,
role-based access, HTTPS, secure cookies, and auditable persistent manager
writes. Do not turn on real public reports until anti-spam/rate-limiting and
moderation controls are in place. A public viewer account is not needed;
a report-writer account is optional if an appropriate guest submission
anti-abuse workflow exists.

To return to the real-data view
-------------------------------
Stop this Flask process and use the NORMAL Flask command without
ENABLE_SYNTHETIC_DEMO=true. The display then uses only existing warehouse
metrics. To undo source changes, restore the five backed-up source files
from the backup folder printed by the installer (not your MySQL database).

Tested against the uploaded pre-Overture restored site, including its V8.1
conservative de-duplication API bridge. Syntax and deterministic-function
tests have been executed; a connection to your Mac's MySQL server was NOT
available for integration verification.
