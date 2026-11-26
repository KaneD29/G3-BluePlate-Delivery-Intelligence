"""Validate an attributed OSM JSON extract without network or database access.

Imports named restaurant/fast_food/cafe nodes only. Ways/relations are counted
as excluded, never converted into invented point coordinates.
"""
import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from etl.proxy_metrics_engine import haversine_km
from etl.config import UST_COORDS


def load_offline_osm(filename, manifest=None):
    path = Path(filename)
    raw = path.read_bytes()
    meta = json.loads(Path(manifest or path.with_suffix('.manifest.json')).read_text())
    digest = hashlib.sha256(raw).hexdigest()
    if meta.get('sha256') != digest:
        raise ValueError('OSM extract checksum does not match its provenance manifest')
    url = urlparse(meta.get('source_url', ''))
    if url.scheme != 'https' or url.hostname not in {'api.openstreetmap.org', 'overpass-api.de', 'overpass.private.coffee', 'maps.mail.ru'}:
        raise ValueError('Manifest must identify the original official OSM or supported Overpass HTTPS export URL')
    if meta.get('attribution') != '© OpenStreetMap contributors' or meta.get('license') != 'https://opendatacommons.org/licenses/odbl/1-0/':
        raise ValueError('Missing OSM attribution or ODbL license')
    if not datetime.fromisoformat(meta.get('retrieved_at', '')).tzinfo:
        raise ValueError('retrieved_at must include a timezone')
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get('elements'), list) or data.get('remark'):
        raise ValueError('Expected a complete OSM JSON elements array without a server error')
    # new addition 1
    node_coords = {}

    for item in data['elements']:
        if (
            isinstance(item, dict)
            and item.get('type') == 'node'
            and type(item.get('id')) is int
            and item['id'] > 0
        ):
            node_coords[item['id']] = (
                item.get('lat'),
                item.get('lon')
            )
    
    seen = {}; places = []; excluded = 0; duplicates = 0
    for el in data['elements']:
        if not isinstance(el, dict):
            raise ValueError('Invalid OSM element')
        kind, osm_id = el.get('type'), el.get('id')
        if kind not in {'node','way','relation'} or type(osm_id) is not int or osm_id <= 0:
            raise ValueError('OSM type and positive integer ID are required')
        key = (kind, osm_id)
        if key in seen:
            if seen[key] != el:
                raise ValueError(f'Conflicting duplicate OSM record: {key}')
            duplicates += 1
            continue
        seen[key] = el
        tags = el.get('tags', {})
        if not isinstance(tags, dict):
            raise ValueError(f'Invalid tags for {key}')
        if kind not in {'node', 'way'} or tags.get('amenity') not in {'restaurant', 'fast_food', 'cafe'}:
            excluded += 1; continue
        name = tags.get('name')
        if name is None or name == '':
            excluded += 1; continue
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 160:
            raise ValueError(f'Invalid restaurant name for {key}')
        # new addition (2)
        if kind == 'node':
            lat, lng = el.get('lat'), el.get('lon')
        else:
            refs = el.get('nodes')

            if not isinstance(refs, list) or len(refs) < 4:
                excluded += 1
                continue

            if any(type(ref) is not int or ref <= 0 for ref in refs):
                raise ValueError(f'Invalid way references: {key}')

            if refs[0] != refs[-1] or len(set(refs[:-1])) < 3:
                excluded += 1
                continue

            coords = [node_coords.get(ref) for ref in refs[:-1]]

            if any(point is None for point in coords):
                excluded += 1
                continue

            for point in coords:
                a, b = point

                if (
                    any(type(v) not in (int, float) or not math.isfinite(v)
                        for v in point)
                    or not (-90 <= a <= 90 and -180 <= b <= 180)
                ):
                    raise ValueError(f'Invalid way coordinates: {key}')

            lat = sum(point[0] for point in coords) / len(coords)
            lng = sum(point[1] for point in coords) / len(coords)

        if any(type(v) not in (int,float) or not math.isfinite(v) for v in (lat,lng)) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError(f'Invalid coordinates for {key}')
        if haversine_km(*UST_COORDS, lat, lng) > 1.5:
            excluded += 1; continue
        street = tags.get('addr:full') or ' '.join(str(tags[k]) for k in ('addr:housenumber','addr:street') if tags.get(k)) or 'Address not recorded in OSM'
        cuisine = tags.get('cuisine', '')
        if not isinstance(street, str) or len(street) > 255 or not isinstance(cuisine, str):
            raise ValueError(f'Invalid address/cuisine for {key}')
        places.append({'external_place_id': f'osm_{kind}_{osm_id}', 'restaurant_name': name.strip(),
                       'lat': lat, 'lng': lng, 'street_address': street,
                       'cuisine_raw': cuisine, 'amenity_raw': tags['amenity'],
                       'business_status': 'OPERATIONAL'})
    if not places:
        raise ValueError('No named OSM restaurant/cafe/fast-food nodes or ways within 1.5 km of UST')
    possible_duplicates = []
    for i, left in enumerate(places):
        for right in places[i + 1:]:
            if left['restaurant_name'].casefold() == right['restaurant_name'].casefold() and haversine_km(left['lat'], left['lng'], right['lat'], right['lng']) <= 0.03:
                possible_duplicates.append([left['external_place_id'], right['external_place_id']])
    return places, {**meta, 'sha256': digest, 'accepted': len(places), 'excluded': excluded,
                    'identical_duplicates_removed': duplicates, 'possible_same_venue_pairs': possible_duplicates, 'scope': 'Named amenity nodes and closed ways within 1.5 km of UST; relations excluded'}
