# BluePlate Flask v1 release candidate

This is the standalone Flask/MySQL source bundle. It includes the public
directory, read-only BI dashboard, guest-report controls, OSM ETL, schema
setup and tests. The static Next.js deployment on GitHub `main` is separate.
The release ships with production guest writes disabled.

## Reproduce and verify

Run from the source root with CPython 3.14 and Node. The release candidate was
verified on Python 3.14.7 and Node 26.13.0. For schema setup and local operation,
see [README.md](README.md). Use a disposable MySQL schema for acceptance tests.

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt -c requirements-lock.txt
python -m pip check
python -B -m pytest -q -p no:cacheprovider
for test in tests/*.js; do node "$test" || exit; done
python -B tools/package_release.py --output dist/flask-blueplate-v1.zip
python -B tools/package_release.py --verify dist/flask-blueplate-v1.zip
```

For runtime-only dependencies install `requirements.txt` with the same
constraints file. A clean install on the target Linux host and a supported
production WSGI runner remain part of deployment preparation.

[release-files.txt](release-files.txt) lists every source file in the ZIP.
The packager generates `RELEASE-MANIFEST.sha256` for those files and emits
identical ZIP bytes for identical inputs. It refuses existing output paths.
The audit rejects prohibited paths and scans for common credential and dump
signatures. It is a release check, not a substitute for repository secret
scanning and human review. Never add real configuration or credentials to
the allowlist.

The only included dataset is the attributed OpenStreetMap extract and its
SHA-256 provenance sidecar. Keep the pair together and retain the ODbL notice
in the app and any redistribution. See
[offline OSM validation](docs/OFFLINE_OSM_VALIDATION.md).
SQL files are schema, seed, and verification source for the prototype. They
contain local database directives and require operator review and explicit
target selection before use outside a disposable local environment.

## Proposed GitHub branch

After approval, start `release/flask-blueplate-v1` from
`feature/osm-synthetic-dashboard` and update the existing
`prototype/osm-synthetic-dashboard/` subtree with the verified source
allowlist. Replace the old subtree release guide with this one and inspect
the staged path list. Keep the generated ZIP, checksum file inside the ZIP,
and local working directory out of Git. The packaged source includes no
workflow and the branch should leave inherited workflow and `deploy/` files
untouched. Keep work on the release branch and avoid running the legacy paid
site workflow manually or merging this release into `main`.

## Before production

Confirm the Linux runtime and dependency advisories, a dedicated MySQL
schema and verified DB TLS, the approved proxy and HTTPS hostname, shared
ingress limits, Turnstile keys, and a tested WSGI/service rollout. Enable
public writes only after the staged HTTPS guest flow passes. Do not enable
the development demo or manager token in production.
