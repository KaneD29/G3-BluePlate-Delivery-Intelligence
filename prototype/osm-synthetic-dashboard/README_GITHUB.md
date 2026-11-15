# BluePlate — OSM-only Flask prototype + synthetic BI demo

This folder contains the **local Flask/MySQL prototype** of BluePlate, based on
OpenStreetMap (OSM) restaurant locations around UST Manila. It is intentionally
isolated from the group repository's existing `deploy/` infrastructure.

**Not a production deployment.** The admin page has **no server-side login**.
Do not expose its administrative endpoints to the public internet. Its demo
reports and manager actions are browser-local. The sample ratings, health
statuses, risk indexes, delivery estimates, alerts and trends are **synthetic**,
not observed restaurant performance or real customer orders.

## Local startup

1. Install Python 3.11+, MySQL 8+ and the dependencies in `requirements.txt`.
2. Create a local `.env` using `.env.example` and put **real credentials only in
   your untracked local `.env`**. Set `MYSQL_PORT` to match your local server.
3. Initialize or connect to the project's pre-existing `blueplate_dw` schema.
   Review migrations carefully; do **not** rerun initial SQL against existing data.
4. Start Flask from this folder:

   ```bash
   bash RUN_BLUEPLATE_SYNTHETIC_DEMO.command
   ```

5. Open `http://127.0.0.1:5001/` and `http://127.0.0.1:5001/admin/`.

Without the private database configuration and populated MySQL instance, this
source package alone will not reproduce the live restaurant-directory count.
The Overture experiment, its staged records and publishing scripts are **not
part of this GitHub update**.

## Data sources and rights

Restaurant reference data: © OpenStreetMap contributors, made available under
the Open Database License (ODbL). See https://www.openstreetmap.org/copyright
and https://opendatacommons.org/licenses/odbl/1-0/ . Keep attribution visible
when displaying or redistributing derived restaurant data. Review ODbL
obligations before publishing a modified database.

The included `data/osm/` snapshot is **public OSM input data** for offline
reproducibility, not a copy of local MySQL credentials, records of customer
orders, or actual customer reviews.

## Relationship to the group's deployed application

The repository's production pipeline builds a **different deployed application**.
Placing this source under `prototype/osm-synthetic-dashboard/` does **not**
automatically deploy Flask/MySQL through the existing GitHub Actions workflow.
Coordinate backend architecture, login/access control, and deployment with the
team before merging any prototype code into production paths.
