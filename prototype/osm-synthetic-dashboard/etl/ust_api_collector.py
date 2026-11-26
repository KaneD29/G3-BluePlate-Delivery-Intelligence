
import time
import json
import urllib.robotparser
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from etl.config import (
    UST_COORDS,
    SEARCH_RADIUS_METERS,
    BOT_USER_AGENT,
)


OVERPASS_MIRRORS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

def fetch_ust_eateries_osm_overpass() -> list[dict]:
    """Return live OSM venues only; abort if every mirror fails or is empty.

    Never substitute synthetic venues: the warehouse records this source as OSM.
    """
    query = f"""
    [out:json][timeout:10];
    node["amenity"~"restaurant|fast_food|cafe"](around:1000,{UST_COORDS[0]},{UST_COORDS[1]});
    out body;
    """
    for endpoint in OVERPASS_MIRRORS:
        try:
            resp = requests.post(
                endpoint,
                data={"data": query},
                headers={"User-Agent": BOT_USER_AGENT},
                timeout=(5, 15),
            )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError):
            continue
        if not isinstance(data, dict) or not isinstance(data.get("elements"), list) or data.get("remark"):
            continue

        eateries = []
        seen_ids = set()
        for el in data["elements"]:
            if not isinstance(el, dict) or el.get("type") != "node" or not isinstance(el.get("id"), int):
                continue
            tags = el.get("tags", {})
            if not isinstance(tags, dict):
                continue
            name = str(tags.get("name", "")).strip()
            if not name:
                continue
            ext_id = f"osm_{el['type']}_{el['id']}"
            if ext_id in seen_ids:
                continue
            try:
                lat, lng = float(el["lat"]), float(el["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                continue
            seen_ids.add(ext_id)
            street = tags.get("addr:street") or tags.get("addr:full") or "Sampaloc, Manila"
            eateries.append({
                "external_place_id": ext_id, "restaurant_name": name,
                "street_address": street, "lat": lat, "lng": lng,
                "cuisine_raw": tags.get("cuisine", ""),
                "amenity_raw": tags.get("amenity", "restaurant"),
                "business_status": "OPERATIONAL",
            })
        if eateries:
            print(f"[BluePlate collector] Live Overpass response: {len(eateries)} named venues ({endpoint}).")
            return eateries
    raise RuntimeError(
        "No usable live OpenStreetMap venues from any Overpass mirror. "
        "ETL stopped before database writes; synthetic fallback is disabled."
    )


# ============================================================
# PUBLIC MENU COLLECTOR (JSON-LD)
# ============================================================

def fetch_public_menu_jsonld(
    storefront_url: str,
    crawl_delay_sec: float = 4.0
) -> list[dict]:
    """
    Rate-limited legal bot:
    checks robots.txt first and parses public schema.org
    JSON-LD menu items.
    """

    parsed = urlparse(storefront_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"

    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(robots_url)
    rp.read()

    if not rp.can_fetch(BOT_USER_AGENT, storefront_url):
        raise PermissionError(
            f"Blocked by robots.txt policy: {storefront_url}"
        )

    time.sleep(crawl_delay_sec)

    resp = requests.get(
        storefront_url,
        headers={"User-Agent": BOT_USER_AGENT},
        timeout=15
    )

    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    menu_items = []

    for script in soup.find_all(
        "script",
        type="application/ld+json"
    ):
        try:
            payload = json.loads(script.string or "{}")

            if payload.get("@type") == "Restaurant" and "hasMenu" in payload:
                sections = payload["hasMenu"].get(
                    "hasMenuSection", []
                )

                for sec in sections:
                    for item in sec.get("hasMenuItem", []):
                        offer = item.get("offers", {})

                        menu_items.append(
                            {
                                "item_name": item.get("name"),
                                "menu_category": sec.get(
                                    "name", "Main Menu"
                                ),
                                "price_php": float(
                                    offer.get("price", 0.0)
                                ),
                            }
                        )

        except (json.JSONDecodeError, ValueError):
            continue

    return menu_items
