"""Rebuild the read-only BluePlate dashboard asset from its eleven source CSVs.

Usage: python scripts/prepare-data.py [--source-dir /path/to/csvs]
No source files are modified. Decimal fact rounding mirrors the supplied MySQL SQL.
"""
import argparse
import collections
import json
import math
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone

import pandas as pd

PROJECT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=Path, default=PROJECT.parents[1] / 'blueplate-review' / 'data')
args = parser.parse_args()
SOURCE = args.source_dir
NAMES = ['restaurants', 'restaurant_statistics', 'delivery_metrics', 'cities', 'city_statistics', 'countries', 'cuisines', 'menus', 'nutrition', 'price_history', 'restaurant_features']
D = {name: pd.read_csv(SOURCE / (name + '.csv')) for name in NAMES}

def dec(value):
    return Decimal(str(value))

def rounded(value):
    return float(dec(value).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))

def percent(numerator, denominator):
    if pd.isna(denominator) or denominator == 0:
        return None
    return rounded(dec(numerator) / dec(denominator) * 100)

def flag(value):
    if pd.isna(value):
        return None
    return str(value).lower() in ('true', '1', 'yes', 'y', 't')

def finite(value):
    if value is None or pd.isna(value):
        return None
    return float(value)

def average(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None

r = D['restaurants']
s = D['restaurant_statistics']
rs = r.merge(s, on='Restaurant_ID', validate='one_to_one')
city_average = rs.groupby(['City', 'Country']).Average_menu_price.transform('mean')
rs['price_deviation_pct'] = [percent(abs(dec(p) - dec(a)), a) for p, a in zip(rs.Average_menu_price, city_average)]
rs['is_low_rated'] = (rs.Average_rating < 4).astype(int)

dp = D['delivery_metrics'].merge(rs[['Restaurant_ID', 'City', 'Country', 'Average_menu_price']], on='Restaurant_ID', validate='one_to_one')
dp['delivery_time_overrun_pct'] = [percent(dec(a) - dec(e), e) for a, e in zip(dp.Average_delivery_time, dp.Estimated_delivery_time)]
dp['cancellation_rate_pct'] = dp.Cancellation_rate.map(lambda v: rounded(dec(v) * 100))
dp['is_available'] = dp.Availability.map(flag).astype(int)
dp['delivery_fee_burden_pct'] = [percent(dec(a) + dec(b) + dec(c), p) for a, b, c, p in zip(dp.Delivery_fee, dp.Service_fee, dp.Packaging_fee, dp.Average_menu_price)]

ph = D['price_history'].copy()
ph['price_change_pct'] = [percent(abs(dec(c) - dec(p)), p) for c, p in zip(ph.Current_price, ph.Previous_price)]

city = rs.groupby(['City', 'Country']).agg(restaurant_count=('Restaurant_ID', 'size'), avg_rating=('Average_rating', 'mean'), low_rated_pct=('is_low_rated', lambda v: v.mean() * 100), avg_price_deviation_pct=('price_deviation_pct', 'mean'))
city = city.join(dp.groupby(['City', 'Country']).agg(avg_delivery_time=('Average_delivery_time', 'mean'), avg_overrun_pct=('delivery_time_overrun_pct', 'mean'), avg_cancellation_rate=('cancellation_rate_pct', 'mean'), avg_availability_pct=('is_available', lambda v: v.mean() * 100), avg_delivery_fee_burden=('delivery_fee_burden_pct', 'mean'), peak_multiplier_avg=('Peak_hour_multiplier', 'mean')))
city = city.join(D['city_statistics'].set_index(['City', 'Country'])[['Delivery_coverage']])
city['delivery_coverage_pct'] = city.pop('Delivery_coverage') * 100
for column in city.columns:
    if column != 'restaurant_count':
        city[column] = city[column].map(rounded)

currency_by_country = D['countries'].set_index('Country').Currency.to_dict()
dp_by_id = dp.set_index('Restaurant_ID').to_dict('index')
restaurants = []
for row in rs.to_dict('records'):
    delivery = dp_by_id.get(row['Restaurant_ID'])
    restaurants.append({
        'id': str(row['Restaurant_ID']), 'name': row['Restaurant_name'], 'city': row['City'], 'country': row['Country'],
        'cuisine': row['Cuisine'], 'rating': finite(row['Average_rating']), 'reviewCount': int(row['Review_count']),
        'chain': row['Chain_local'], 'status': row['Business_status'], 'deliveryEnabled': flag(row['Delivery_available']),
        'available': bool(delivery['is_available']) if delivery else None,
        'avgMenuPrice': finite(row['Average_menu_price']), 'currency': currency_by_country[row['Country']],
        'deliveryTime': finite(delivery['Average_delivery_time']) if delivery else None,
        'estimatedTime': finite(delivery['Estimated_delivery_time']) if delivery else None,
        'overrun': finite(delivery['delivery_time_overrun_pct']) if delivery else None,
        'cancellation': finite(delivery['cancellation_rate_pct']) if delivery else None,
        'feeBurden': finite(delivery['delivery_fee_burden_pct']) if delivery else None,
        'peakMultiplier': finite(delivery['Peak_hour_multiplier']) if delivery else None,
        'priceDeviation': finite(row['price_deviation_pct']),
        'latitude': finite(row['Latitude']), 'longitude': finite(row['Longitude']),
    })
restaurant_by_id = {row['id']: row for row in restaurants}

cities = []
city_context = D['cities'].set_index(['City', 'Country']).to_dict('index')
for (name, country), row in city.iterrows():
    cities.append({'city': name, 'country': country, 'coverage': float(row.delivery_coverage_pct),
        'population': int(city_context[(name, country)]['Population']),
        'restaurantCount': int(row.restaurant_count), 'deliveryTime': float(row.avg_delivery_time),
        'overrun': float(row.avg_overrun_pct), 'cancellation': float(row.avg_cancellation_rate),
        'availability': float(row.avg_availability_pct), 'rating': float(row.avg_rating),
        'lowRated': float(row.low_rated_pct), 'priceDeviation': float(row.avg_price_deviation_pct),
        'feeBurden': float(row.avg_delivery_fee_burden), 'peakMultiplier': float(row.peak_multiplier_avg)})

menu_by_id = D['menus'].set_index('Menu_ID').to_dict('index')
price_changes = []
for row in ph.to_dict('records'):
    menu = menu_by_id[row['Menu_ID']]
    restaurant = restaurant_by_id[str(menu['Restaurant_ID'])]
    price_changes.append({'menuId': str(row['Menu_ID']), 'item': menu['Item_name'],
        'restaurantId': restaurant['id'], 'restaurant': restaurant['name'], 'city': restaurant['city'],
        'country': restaurant['country'], 'currency': menu['Currency'], 'date': row['Timestamp'],
        'current': finite(row['Current_price']), 'previous': finite(row['Previous_price']),
        'changePct': float(row['price_change_pct'])})
price_changes.sort(key=lambda row: (row['changePct'], row['date']), reverse=True)
for index, row in enumerate(price_changes, 1):
    row['id'] = index

threshold_rows = [
    (1, 'Average Delivery Time', 'min', 'LOWER_IS_BETTER', 35, 45),
    (2, 'Delivery Time Overrun', '%', 'LOWER_IS_BETTER', 10, 20),
    (3, 'Average Cancellation Rate', '%', 'LOWER_IS_BETTER', 5, 10),
    (4, 'Restaurant Delivery Availability', '%', 'HIGHER_IS_BETTER', 95, 90),
    (5, 'Average Restaurant Rating', '/5', 'HIGHER_IS_BETTER', 4.3, 4),
    (6, 'Low-Rated Restaurant Percentage', '%', 'LOWER_IS_BETTER', 9.99, 20),
    (7, 'Menu Price Deviation', '%', 'LOWER_IS_BETTER', 15, 25),
    (8, 'Individual Menu Price Change', '%', 'LOWER_IS_BETTER', 5, 10),
    (9, 'Delivery Fee Burden', '%', 'LOWER_IS_BETTER', 15, 25),
    (10, 'Peak-Hour Pricing Multiplier', '×', 'LOWER_IS_BETTER', 1.2, 1.5),
    (11, 'City Delivery Coverage', '%', 'HIGHER_IS_BETTER', 90, 80),
    (12, 'Relational Data Integrity', '%', 'HIGHER_IS_BETTER', 99, 97),
]
thresholds = [dict(zip(['id', 'name', 'unit', 'direction', 'normal', 'warning'], row)) for row in threshold_rows]
threshold_by_id = {row['id']: row for row in thresholds}

def status(kpi_id, value):
    if value is None:
        return None
    threshold = threshold_by_id[kpi_id]
    if threshold['direction'] == 'LOWER_IS_BETTER':
        return 'NORMAL' if value <= threshold['normal'] else 'WARNING' if value <= threshold['warning'] else 'CRITICAL'
    return 'NORMAL' if value >= threshold['normal'] else 'WARNING' if value >= threshold['warning'] else 'CRITICAL'

alerts = []
def alert(kpi_id, scope, value, city=None, country=None, restaurant_id=None, restaurant=None, menu_id=None, item=None, date=None):
    state = status(kpi_id, value)
    if state not in ('WARNING', 'CRITICAL'):
        return
    alerts.append({'kpiId': kpi_id, 'scope': scope, 'city': city, 'country': country,
        'restaurantId': restaurant_id, 'restaurant': restaurant, 'menuId': menu_id, 'item': item,
        'value': value, 'status': state, 'date': date})

city_metrics = {1: 'deliveryTime', 2: 'overrun', 3: 'cancellation', 4: 'availability', 5: 'rating', 6: 'lowRated', 7: 'priceDeviation', 9: 'feeBurden', 10: 'peakMultiplier', 11: 'coverage'}
for row in cities:
    for kpi_id, field in city_metrics.items():
        alert(kpi_id, 'CITY', row[field], row['city'], row['country'])
restaurant_metrics = {1: 'deliveryTime', 2: 'overrun', 3: 'cancellation', 5: 'rating', 7: 'priceDeviation', 9: 'feeBurden', 10: 'peakMultiplier'}
for row in restaurants:
    for kpi_id, field in restaurant_metrics.items():
        alert(kpi_id, 'RESTAURANT', row[field], row['city'], row['country'], row['id'], row['name'])
for row in price_changes:
    alert(8, 'MENU_ITEM', row['changePct'], row['city'], row['country'], row['restaurantId'], row['restaurant'], row['menuId'], row['item'], row['date'])

checks = []
def check(check_id, name, source, values):
    total, valid = len(values), int(values.sum())
    checks.append({'id': check_id, 'name': name, 'source': source, 'scope': 'GLOBAL', 'total': total,
        'valid': valid, 'failed': total - valid, 'integrity': rounded(valid / total * 100) if total else None})
check('restaurant-city', 'Restaurant resolves to a city', 'restaurants', pd.Series(list(zip(r.City, r.Country))).isin(list(zip(D['cities'].City, D['cities'].Country))))
check('restaurant-cuisine', 'Restaurant resolves to a cuisine', 'restaurants', r.Cuisine.isin(D['cuisines'].Cuisine_name))
check('delivery-present', 'Delivery-enabled restaurant has delivery metrics', 'restaurants', r.loc[r.Delivery_available.map(flag), 'Restaurant_ID'].isin(dp.Restaurant_ID))
check('delivery-restaurant', 'Delivery metrics link to a restaurant', 'delivery_metrics', dp.Restaurant_ID.isin(r.Restaurant_ID))
check('statistics-restaurant', 'Restaurant statistics link to a restaurant', 'restaurant_statistics', s.Restaurant_ID.isin(r.Restaurant_ID))
check('features-restaurant', 'Restaurant features link to a restaurant', 'restaurant_features', D['restaurant_features'].Restaurant_ID.isin(r.Restaurant_ID))
check('menu-restaurant', 'Menu item links to a restaurant', 'menus', D['menus'].Restaurant_ID.isin(r.Restaurant_ID))
check('positive-price', 'Menu item has a positive price', 'menus', D['menus'].Price > 0)
nutrition = D['menus'].merge(D['nutrition'], on='Menu_ID', how='left', suffixes=('_menu', '_nutrition'), validate='one_to_one')
check('nutrition-calories', 'Nutrition row matches menu item calories', 'nutrition', nutrition.Calories_menu.eq(nutrition.Calories_nutrition))
check('history-menu', 'Price history links to a menu item', 'price_history', ph.Menu_ID.isin(D['menus'].Menu_ID))
check('price-change', 'Price change = current − previous', 'price_history', (ph.Current_price - ph.Previous_price - ph.Price_change).abs() < .02)
integrity = sum(row['valid'] for row in checks) / sum(row['total'] for row in checks) * 100
alert(12, 'GLOBAL', integrity)
alerts.sort(key=lambda row: (row['status'] != 'CRITICAL', row['kpiId'], row['city'] or '', row['restaurant'] or '', row['menuId'] or ''))
for index, row in enumerate(alerts, 1):
    row['id'] = index

def baseline(selected):
    delivery = [row for row in selected if row['deliveryTime'] is not None]
    return {'restaurants': len(selected), 'deliveryRestaurants': len(delivery),
        'deliveryTime': rounded(average([row['deliveryTime'] for row in delivery])),
        'overrun': rounded(average([row['overrun'] for row in delivery])),
        'cancellation': rounded(average([row['cancellation'] for row in delivery])),
        'availability': rounded(average([int(row['available']) for row in delivery]) * 100),
        'rating': rounded(average([row['rating'] for row in selected])),
        'lowRated': rounded(sum(row['rating'] < 4 for row in selected) / len(selected) * 100),
        'priceDeviation': rounded(average([row['priceDeviation'] for row in selected])),
        'feeBurden': rounded(average([row['feeBurden'] for row in delivery])),
        'peakMultiplier': rounded(average([row['peakMultiplier'] for row in delivery]))}

global_baseline = baseline(restaurants)
global_baseline.update({'cities': len(cities), 'countries': len(D['countries']), 'menus': len(D['menus']),
    'priceChanges': len(price_changes), 'maxPriceChange': max(row['changePct'] for row in price_changes),
    'coverage': rounded(average([row['coverage'] for row in cities])),
    'cityRating': rounded(average([row['rating'] for row in cities])),
    'citiesBelowCoverage': sum(row['coverage'] < 90 for row in cities),
    'alerts': len(alerts), 'criticalAlerts': sum(row['status'] == 'CRITICAL' for row in alerts),
    'warningAlerts': sum(row['status'] == 'WARNING' for row in alerts), 'kpisWithBreaches': len(set(row['kpiId'] for row in alerts)),
    'integrity': integrity, 'checks': len(checks), 'failedValidations': sum(row['failed'] for row in checks)})
delhi_baseline = baseline([row for row in restaurants if row['city'] == 'Delhi' and row['country'] == 'India'])

expected = {'restaurants': 5000, 'deliveryRestaurants': 3187, 'deliveryTime': 55.54, 'overrun': 6.92,
    'cancellation': 4.98, 'availability': 49.67, 'rating': 3.5, 'lowRated': 64.72, 'priceDeviation': 40.73,
    'feeBurden': 20.43, 'peakMultiplier': 1.75, 'cities': 10, 'countries': 5, 'menus': 62417,
    'priceChanges': 18887, 'maxPriceChange': 25, 'coverage': 78.55, 'cityRating': 3.51, 'citiesBelowCoverage': 9,
    'alerts': 36391, 'criticalAlerts': 25813, 'warningAlerts': 10578, 'kpisWithBreaches': 11,
    'integrity': 100, 'checks': 11, 'failedValidations': 0}
assert global_baseline == expected, (global_baseline, expected)
for field, value in {'restaurants': 509, 'deliveryTime': 54.83, 'cancellation': 5.36, 'rating': 3.47, 'availability': 53.54}.items():
    assert delhi_baseline[field] == value, (field, delhi_baseline[field], value)
assert len({row['id'] for row in restaurants}) == len(restaurants)
assert all(row['city'] and row['country'] for row in alerts)
assert all(row['date'] is None for row in alerts if row['scope'] != 'MENU_ITEM')

payload = {
    'metadata': {'label': 'BluePlate restaurant intelligence dataset', 'snapshotDate': None, 'sourceDate': None,
        'sourceLabel': 'BluePlate capstone source CSVs', 'sourceAsOf': None, 'preparedAt': datetime.now(timezone.utc).isoformat(),
        'auditDate': '2026-11-08', 'historyStart': str(ph.Timestamp.min())[:10], 'historyEnd': str(ph.Timestamp.max())[:10],
        'snapshotLabel': 'Dataset snapshot', 'historyLabel': 'Price history · 2023', 'checkScope': 'GLOBAL',
        'syntheticTransactionsIncluded': False,
        'sourceFiles': {name + '.csv': len(D[name]) for name in NAMES},
        'notes': ['Source snapshot observation date is not supplied. Audit date is not observation date.',
            'Snapshot metrics are unweighted restaurant-level measures, not transaction-weighted rates.',
            'Delivery availability uses the delivery-metrics population.',
            'Price change is absolute percentage change. Currency amounts are never converted or summed across currencies.',
            'Alerts combine undated snapshot violations and historical menu-price violations.',
            'Integrity reflects only the eleven implemented source checks.']},
    'restaurants': restaurants, 'cities': cities, 'priceChanges': price_changes,
    'thresholds': thresholds, 'alerts': alerts, 'checks': checks,
    'baseline': global_baseline, 'verification': {'Delhi': delhi_baseline},
}
output = PROJECT / 'public' / 'data' / 'blueplate.json'
output.parent.mkdir(parents=True, exist_ok=True)
serialized = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
output.write_text(serialized, encoding='utf-8')
print(json.dumps({'output': str(output), 'bytes': output.stat().st_size, 'counts': {key: len(payload[key]) for key in ['restaurants', 'cities', 'priceChanges', 'alerts', 'checks']}, 'baseline': global_baseline, 'Delhi': delhi_baseline}, indent=2))
