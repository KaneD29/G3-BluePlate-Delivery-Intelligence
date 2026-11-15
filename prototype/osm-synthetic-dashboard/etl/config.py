"""Configuration for ETL and the local Flask demonstration API.

Use separate DB users in a real deployment: ETL writes facts, API reads BI data,
application account writes guest reports and manager actions. The fallback is
for local backwards compatibility and is NOT a production security boundary.
"""
import os
from dotenv import load_dotenv

load_dotenv()


def database_config(prefix="MYSQL"):
    """Resolve MYSQL_* or APP_DB_*; APP_DB_* falls back to original local credentials."""
    if prefix not in {"MYSQL", "APP_DB"}:
        raise ValueError("Unsupported DB prefix")
    def value(field, default):
        from_env = os.getenv(f"{prefix}_{field}")
        if from_env is not None:
            return from_env
        return os.getenv(f"MYSQL_{field}", default)
    return {
        "host": value("HOST", "127.0.0.1"),
        "port": int(value("PORT", "3306")),
        "user": value("USER", ""),
        "password": value("PASSWORD", ""),
        "database": value("DATABASE", "blueplate_dw"),
        "connection_timeout": 10,
    }


DB_CONFIG = database_config("MYSQL")  # Existing ETL import remains compatible.
UST_COORDS = (
    float(os.getenv("UST_CENTER_LAT", "14.6091")),
    float(os.getenv("UST_CENTER_LNG", "120.9895")),
)
SEARCH_RADIUS_METERS = int(os.getenv("UST_SEARCH_RADIUS_METERS", "1500"))
BOT_USER_AGENT = "BluePlateBI-ResearchBot/1.0 (+https://blueplate-bi.local/bot-policy)"
