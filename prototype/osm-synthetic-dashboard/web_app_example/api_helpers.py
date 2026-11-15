"""Input, date-range, response, and status helpers for the BluePlate V8 API."""
import csv
from datetime import date, datetime, timedelta
from decimal import Decimal
from io import StringIO
from zoneinfo import ZoneInfo

MANILA = ZoneInfo("Asia/Manila")
ACTION_CATEGORY_MAP = {
    "Delivery Delay": "DELIVERY_DELAY",
    "Pickup Issue": "PICKUP_ISSUE",
    "Traffic": "TRAFFIC",
    "Restaurant Issue": "RESTAURANT_ISSUE",
    "Customer Feedback": "CUSTOMER_FEEDBACK",
    "General Observation": "GENERAL_OBSERVATION",
}
LEGACY_CATEGORY_NAMES = {
    "WEATHER_FLOOD": "Weather / Flood",
    "CAMPUS_EVENT": "Campus Event",
    "MERCHANT_AUDIT": "Merchant Audit",
    "PRICING_ACTION": "Pricing Action",
    "OTHER": "Other",
}
CATEGORY_NAME_MAP = {v: k for k, v in ACTION_CATEGORY_MAP.items()} | LEGACY_CATEGORY_NAMES
STATUSES = {"OPEN", "IN_PROGRESS", "RESOLVED"}


class ValidationError(ValueError):
    pass


def positive_integer(value, name, *, maximum=2147483647):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValidationError(f"{name} must be a positive integer")
    try:
        n = int(value)
    except (ValueError, TypeError):
        raise ValidationError(f"{name} must be a positive integer") from None
    if n < 1 or n > maximum or str(n) != str(value).strip():
        raise ValidationError(f"{name} must be a positive integer")
    return n


def parse_period(args):
    """Inclusive day range, in the UST local timezone; at most 366 days."""
    today = datetime.now(MANILA).date()
    default_from = today - timedelta(days=6)
    start_raw = args.get("from", default_from.isoformat())
    end_raw = args.get("to", today.isoformat())
    try:
        start = date.fromisoformat(start_raw)
        end = date.fromisoformat(end_raw)
    except (ValueError, TypeError):
        raise ValidationError("from and to must be YYYY-MM-DD dates") from None
    if start > end or (end - start).days > 365 or end > today:
        raise ValidationError("Date range must be ordered, at most 366 days, and not future-dated")
    return {
        "from": start.isoformat(), "to": end.isoformat(),
        "start_key": int(start.strftime("%Y%m%d")),
        "end_key": int(end.strftime("%Y%m%d")),
        "start_datetime": start,
        "end_exclusive": end + timedelta(days=1),
    }


def normalize_json(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: normalize_json(v) for key, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize_json(v) for v in value]
    return value


def classify(value, threshold, higher_is_worse=True):
    """No observation yields UNKNOWN, not a fabricated green/Normal status."""
    if value is None or not threshold:
        return "UNKNOWN"
    val = float(value)
    warning = float(threshold["warning_limit"])
    critical = float(threshold["critical_limit"])
    if higher_is_worse:
        return "CRITICAL" if val >= critical else "WARNING" if val >= warning else "NORMAL"
    return "CRITICAL" if val < critical else "WARNING" if val < warning else "NORMAL"


def combined_health(row, thresholds):
    assessments = (
        classify(row.get("proxy_delivery_mins"), thresholds.get("DELIVERY_ETA_MINS")),
        classify(row.get("cancellation_risk_index"), thresholds.get("CANCELLATION_PROXY_PCT")),
        classify(row.get("public_avg_rating"), thresholds.get("AVG_RATING"), False),
    )
    # A missing metric is not evidence of normal health. A known warning/critical
    # still matters, but an otherwise clean *partial* record remains UNKNOWN.
    if "CRITICAL" in assessments:
        return "CRITICAL"
    if "WARNING" in assessments:
        return "WARNING"
    return "NORMAL" if all(v == "NORMAL" for v in assessments) else "UNKNOWN"


def safe_csv(rows, headers):
    """Escape cells that Excel/Sheets could interpret as formulas."""
    buf = StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow(headers)
    for row in rows:
        output = []
        for key in headers:
            v = row.get(key, "")
            v = "" if v is None else str(v)
            if v.lstrip().startswith(("=", "+", "-", "@")):
                v = "'" + v
            output.append(v)
        writer.writerow(output)
    return "\ufeff" + buf.getvalue()  # Excel UTF-8 BOM for Philippine text.
