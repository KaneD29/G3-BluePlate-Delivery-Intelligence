# Warehouse architecture

MySQL 8.0 hosts the restaurant and reference dimensions, legacy facts, typed scenario facts, directory review overlay and separate student-submission data. Flask reads the unified views for dashboards and protects writes to the guest-report workflow. Gunicorn runs behind a managed reverse proxy on Linux.

The November 15 historical warehouse uses its original legacy measures. The November 25 model uses a typed scenario grain, linked to the existing date dimension and stable restaurant keys. The view catalog exposes both analytical dates. Publisher and backup hashes are provenance metadata. The sanitized public seed preserves the reviewed cohort and CSV, removes live guest-count fields from audit JSON and replaces private backup digests with an explicit all-zero marker.

See docs/VERSIONED_BI_WAREHOUSE.md for the technical methodology and database/13_versioned_bi.sql for the additive schema.
