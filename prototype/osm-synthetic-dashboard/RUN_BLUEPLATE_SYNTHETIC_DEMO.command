#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ -f .venv/bin/activate ]; then source .venv/bin/activate; fi
export BLUEPLATE_ENV=development
export ENABLE_SYNTHETIC_DEMO=true
exec python -m flask --app web_app_example.flask_db_connector:app run --host 127.0.0.1 --port 5001 --no-reload
