# Database setup

Use a staging MySQL 8.0 server and the schema name blueplate_dw. Run from the application root. The explicit target UUID comes from SELECT @@server_uuid on the authorized staging server. Supply the administrator's MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD and optional MYSQL_TLS_CA in a private shell or administrator-only environment file. Leave these credentials out of the app service.

```sh
.venv/bin/python tools/install_warehouse.py --mode fresh
.venv/bin/python tools/install_warehouse.py --mode fresh --apply --expected-server-uuid "$TARGET_MYSQL_UUID"
```

Fresh mode requires that blueplate_dw does not exist. It applies migrations 01–04, loads the released reference dimensions and original fact rows, applies 06 and 07, then applies the directory expansion/overlay and versioned BI migration 13. The released seed supplies reference dimensions in place of the historical 05 seed. Migrations 05, 08 and 09 are retained for provenance and old verification. The installer skips migration 09 because the reference seed already supplies the historical zone labels and lunch slot. The installed schema has no student reports or application accounts.

For an existing compatible warehouse, take a fresh private backup, verify its restore in staging, and pause application writes during the maintenance window. The installer requires migrations 06 and 07, matching original restaurant identities and historical facts, and no previous expansion. Run the same commands with --mode existing. It appends the reviewed directory and model while retaining the existing report tables. A customized or partially migrated schema needs a separately tested reconciliation. Do not rerun blindly after a failed DDL step, which can commit independently.

Provision the app account separately using credentials generated and stored by the operator. Grant SELECT on blueplate_dw and INSERT on blueplate_dw.app_user_reviews only if the approved reporting feature will be used. Limit its host and network, and keep schema/admin permissions separate. Do not run the installer using the app account.

Validate the current directory and model counts through /api/dashboard/student-period?latest=1 and the historical view through /api/dashboard/overview?from=2026-11-15&to=2026-11-15. Move any genuine existing reports only through a separately authorized private migration that preserves restaurant_key, submission IDs and timestamps. The public seed never imports reports.

## Step 7.15L upgrade

Fresh and compatible installs include migration 14. For a warehouse already on the published 7.15J.11 release, verify the database hostname, server UUID and schema, back up the warehouse and test restoration, then apply database/14_unlisted_guest_reports.sql once using the administrative account against blueplate_dw. Enable BLUEPLATE_UNLISTED_REPORTS=true after schema verification and check /api/ready. Hosted submissions retain their independent opt-in and production controls. Roll back the application by disabling the flag and restoring the previous files. Keep the additive columns and any newly received genuine reports. If serving the prior application version, keep guest collection disabled and use the patched app for analytics while unresolved rows exist.
