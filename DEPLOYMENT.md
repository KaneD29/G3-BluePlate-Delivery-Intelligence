# BluePlate production deployment

Merges and pushes to `main` trigger [BluePlate Flask production](https://github.com/KaneD29/G3-BluePlate-Delivery-Intelligence/actions/workflows/paid-site.yml). The workflow checks the Flask app under `prototype/osm-synthetic-dashboard`, installs its locked Python dependencies, and packages its runtime on Linux x86-64. A separate deploy job delivers the archive through the existing project-scoped AWS role and Systems Manager command.

Production serves [blueplate.space](https://blueplate.space/) and its `www` hostname from the Flask service on the shared UST EC2. The runner tests the candidate on a private port before routing HTTPS to it. Failed activation restores the previous route and service. Each successful release retains the current and immediate previous Flask release. The original static release and its routing backup provide a rollback path for the first Flask release.

The production app uses a schema-scoped RDS reader with verified TLS for `blueplate_dw`. The initial warehouse was verified with 274 current listings, 274 model venues, and 119 historical venues. The host checks the approved warehouse SQL and seed digests before activation. Changes to those files require a separately reviewed warehouse rollout with a backup and verification. The legacy migration pairs in `deploy/migrations/` belong to the original static dashboard's schema, `2026_3dsa_3_blueplate`.

Public report submission remains gated by the Flask application configuration. Configure and test hostname-specific Turnstile and the required database write permissions before opening hosted report collection. See the [application deployment guide](prototype/osm-synthetic-dashboard/DEPLOYMENT.md).

If a run fails, check its build or SSM summary. After addressing the failure, run the workflow from `main` or re-run all jobs to rebuild the archive with the correct attempt ID. The EC2 operator can find the private runner log in `/var/lib/blueplate-flask/deploy.log`. Host service and routing changes follow a separate, reviewed installation of the files under `deploy/flask-host/`.
