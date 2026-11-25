# Linux staging and deployment

Use CPython 3.14.7, MySQL 8.0, Gunicorn and a same-host TLS reverse proxy. Node is only needed for JavaScript tests. Paths below are examples for a staging host. Configure isolation before testing.

```sh
python3.14 -m venv .venv
.venv/bin/pip install -c requirements-lock.txt -r requirements-deploy.txt
cp .env.example .env
chmod 600 .env
# Edit the local environment file with the staging database credentials.
.venv/bin/gunicorn --workers 1 --threads 4 --bind 127.0.0.1:5000 \
  --forwarded-allow-ips '' web_app_example.flask_db_connector:app
```

Install the warehouse first using DATABASE_SETUP.md. Set BLUEPLATE_ENV=production, use the versioned directory settings in .env.example, disable synthetic/demo manager features, and keep the normal ETL refresh disabled. To restart a managed Linux service, use systemctl restart blueplate and check its readiness before sending traffic.

The application expects one trusted loopback ingress. Nginx must overwrite Host, X-Forwarded-Proto and X-Forwarded-For rather than append user-supplied chain values. Bind Gunicorn to loopback and do not expose port 5000 publicly. Keep the public hostname and HTTPS origin exact. See the Nginx and systemd examples under deployment/. Apply the certificate and operator-managed firewall policy separately. An AWS load balancer or proxy chain requires a separately reviewed ingress design before public guest submission is enabled.

For RDS set APP_DB_HOST to the RDS DNS hostname, configure APP_DB_TLS_CA with the applicable CA bundle and keep the RDS endpoint private. The prepared connector enables certificate and hostname validation when a CA path is supplied. Protect the installer account independently and use MYSQL_TLS_CA if running it over verified TLS.

Leave ENABLE_PRODUCTION_GUEST_REPORTS=false until HTTPS, secure and SameSite cookies, local origin checks, replaced proxy headers, Nginx rate limits, and Turnstile server-side verification have passed staging with the actual hostname. Do not log form tokens or report text. Use a private random Flask secret and Turnstile keys in the environment. Rate limiting is per Flask worker plus the ingress limiter, so the reference service uses one worker unless shared rate limiting has been designed and verified. Local test submissions are permitted only against disposable environments.

Health checks: /api/health, /api/session (capabilities only), /api/dashboard/freshness and /dashboard/. Check database readiness, 274 public listings, 274 current model venues, and the historical 119-venue response. Never replace the existing public site until independent staging acceptance.

## Unlisted restaurant reporting

Apply the 7.15L upgrade in DATABASE_SETUP.md and enable BLUEPLATE_UNLISTED_REPORTS=true when ready. Exercise the listed and unlisted workflows on disposable staging with HTTPS, rate limits and Turnstile before opening collection. The Flask account keeps its existing SELECT and INSERT permissions. Assign review operations to a separate account and keep pending names, locations, and private comments out of logs and exports.
