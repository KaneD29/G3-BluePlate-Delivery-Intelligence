import math
from typing import Dict, Tuple
from etl.config import UST_COORDS


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance in kilometers between two coordinates."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 3)


def assign_ust_zone_code(lat: float, lng: float) -> str:
    """Map coordinates to the nearest UST campus perimeter corridor."""
    zones = {
        "UST-ESPANA": (14.6075, 120.9899),
        "UST-DAPITAN": (14.6119, 120.9888),
        "UST-PNOVAL": (14.6088, 120.9873),
        "UST-LACSON": (14.6104, 120.9922),
    }
    return min(zones.keys(), key=lambda z: haversine_km(lat, lng, zones[z][0], zones[z][1]))


def compute_delivery_eta_proxy(
    distance_km: float,
    prep_baseline_mins: int,
    is_peak_hour: bool,
) -> Tuple[float, float, str]:
    """
    Proxy replacement for private rider telemetry:
    - Urban Manila rider speed ~18 km/h off-peak, ~12 km/h peak rush + 1.35x road winding factor
    - Plus kitchen prep baseline and 4-min campus gate handoff
    """
    speed_kmh = 12.0 if is_peak_hour else 18.0
    road_km = distance_km * 1.35
    road_transit_mins = round((road_km / speed_kmh) * 60.0, 2)
    total_eta = round(road_transit_mins + prep_baseline_mins + 4.0, 2)

    if total_eta >= 45.0:
        severity = "CRITICAL"
    elif total_eta >= 35.0:
        severity = "WARNING"
    else:
        severity = "NORMAL"
    return road_transit_mins, total_eta, severity


def compute_cancellation_proxy(
    unexpected_offline_flips: int,
    out_of_stock_ratio_pct: float,
    cancellation_mentions: int,
) -> Tuple[float, str]:
    """
    Proxy replacement for proprietary platform cancellation rates:
    Weighted composite of mid-shift offline flips, OOS menu ratio, and complaint keywords.
    """
    cpi = round(
        (unexpected_offline_flips * 4.5)
        + (out_of_stock_ratio_pct * 0.25)
        + (cancellation_mentions * 2.0),
        2,
    )
    cpi = min(cpi, 100.0)
    if cpi >= 15.0:
        severity = "CRITICAL"
    elif cpi >= 8.0:
        severity = "WARNING"
    else:
        severity = "NORMAL"
    return cpi, severity


def build_restaurant_enrichment(raw_place: Dict, is_peak_hour: bool = True) -> Dict:
    lat = raw_place["lat"]
    lng = raw_place["lng"]
    dist_km = haversine_km(UST_COORDS[0], UST_COORDS[1], lat, lng)
    zone_code = assign_ust_zone_code(lat, lng)
    transit_mins, total_eta, eta_sev = compute_delivery_eta_proxy(
        dist_km, raw_place.get("prep_baseline_mins", 11), is_peak_hour
    )
    return {
        "distance_to_ust_km": dist_km,
        "zone_code": zone_code,
        "road_transit_mins": transit_mins,
        "estimated_total_delivery_mins": total_eta,
        "delivery_severity": eta_sev,
    }