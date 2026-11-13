"""Prepare synthetic transaction data without modifying source CSVs.

Amounts are integer hundredths of the stated currency, never FX-converted.
One output row per order; one-to-many items are nested to prevent inflated totals.
"""
import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=Path, default=PROJECT.parents[1] / 'blueplate-review' / 'data')
args = parser.parse_args()
names = ['orders', 'order_items', 'deliveries', 'payments', 'customers', 'customer_reviews', 'drivers', 'promotions', 'restaurant_commissions', 'restaurant_operating_hours']
def read(name):
    with (args.source_dir / f'{name}.csv').open(newline='') as f:
        return list(csv.DictReader(f))
D = {name: read(name) for name in names}
restaurants = {r['Restaurant_ID']: r for r in read('restaurants')}
menus = {r['Menu_ID']: r for r in read('menus')}
countries = {r['Country']: r for r in read('countries')}
checks = []
def check(name, total, failed, note=''):
    checks.append(dict(name=name, total=total, valid=total-failed, failed=failed, note=note))
def cents(s):
    return int(Decimal(s) * 100)
def indexed(name, key):
    rows = D[name]
    counts = Counter(r[key] for r in rows)
    assert all(n == 1 for n in counts.values()), f'Duplicate {name} keys'
    return {r[key]: r for r in rows}
orders = indexed('orders', 'order_id')
payments = indexed('payments', 'order_id')
deliveries = indexed('deliveries', 'order_id')
customers = indexed('customers', 'customer_id')
drivers = indexed('drivers', 'driver_id')
reviews = indexed('customer_reviews', 'order_id')
promotions = indexed('promotions', 'promo_id')
commissions = indexed('restaurant_commissions', 'restaurant_id')
hours = D['restaurant_operating_hours']
items = defaultdict(list)
menu_ids = sorted({r['menu_id'] for r in D['order_items']})
menu_index = {key: i for i, key in enumerate(menu_ids)}
for item in D['order_items']:
    items[item['order_id']].append([menu_index[item['menu_id']], int(item['quantity']), cents(item['line_total'])])

check('Unique order and payment keys', len(orders)+len(payments), 0)
check('Order customer, restaurant and payment links', len(orders), sum(r['customer_id'] not in customers or r['restaurant_id'] not in restaurants or r['order_id'] not in payments for r in orders.values()))
check('Order items match their restaurant menu', len(D['order_items']), sum(r['order_id'] not in orders or r['menu_id'] not in menus or menus[r['menu_id']]['Restaurant_ID'] != orders[r['order_id']]['restaurant_id'] for r in D['order_items']))
check('Order line amounts reconcile', len(D['order_items']), sum(cents(r['line_total']) != int(r['quantity']) * cents(r['unit_price']) for r in D['order_items']))
check('Order subtotals reconcile to line items', len(orders), sum(cents(r['subtotal']) != sum(i[2] for i in items[r['order_id']]) for r in orders.values()))
check('Order totals and payment amounts reconcile', len(orders), sum(cents(r['total_amount']) != cents(r['subtotal'])-cents(r['discount_amount'])+cents(r['delivery_fee'])+cents(r['service_fee'])+cents(r['packaging_fee']) or cents(r['total_amount']) != cents(payments[r['order_id']]['amount']) for r in orders.values()))
check('Order currencies match restaurant countries', len(orders), sum(r['currency'] != countries[restaurants[r['restaurant_id']]['Country']]['Currency'] for r in orders.values()))
check('Delivery and payment status match order status', len(orders), sum((r['order_status']=='Delivered') != (r['order_id'] in deliveries and payments[r['order_id']]['payment_status']=='Paid') or (r['order_status']=='Cancelled' and (r['order_id'] in deliveries or payments[r['order_id']]['payment_status'] not in ['Refunded','Voided'])) for r in orders.values()))
check('Delivery order and driver links', len(deliveries), sum(r['order_id'] not in orders or r['driver_id'] not in drivers for r in deliveries.values()))
check('Order-to-delivery duration matches timestamps', len(deliveries), sum(abs((datetime.fromisoformat(r['delivered_ts'])-datetime.fromisoformat(orders[r['order_id']]['order_ts'])).total_seconds()-float(r['actual_minutes'])*60)>1 for r in deliveries.values()))
check('Review order, restaurant and customer links', len(reviews), sum(r['order_id'] not in orders or r['restaurant_id']!=orders[r['order_id']]['restaurant_id'] or r['customer_id']!=orders[r['order_id']]['customer_id'] for r in reviews.values()))
promoted = [r for r in orders.values() if r['promo_id']]
check('Promotion references and active dates', len(promoted), sum(r['promo_id'] not in promotions or not(promotions[r['promo_id']]['start_date']<=r['order_ts'][:10]<=promotions[r['promo_id']]['end_date']) for r in promoted))
check('Restaurant partner tier and rate coverage', len(restaurants), sum(k not in commissions or not 0<=float(commissions[k]['commission_rate_pct'])<=100 for k in restaurants))
check('Operating-hours restaurant and weekday links', len(hours), sum(r['restaurant_id'] not in restaurants or int(r['day_of_week']) not in range(1,8) for r in hours))
check('Orders on or after customer signup', len(orders), sum(r['order_ts'][:10]<customers[r['customer_id']]['signup_date'] for r in orders.values()), 'Retained as synthetic orders; do not use for customer acquisition or lifecycle analysis.')
check('Deliveries on or after driver hire', len(deliveries), sum(r['pickup_ts'][:10]<drivers[r['driver_id']]['hire_date'] for r in deliveries.values()), 'Retained as synthetic deliveries; do not use for driver tenure analysis.')
assert all(c['failed']==0 for c in checks[:-2]), 'Unexpected source reconciliation failure'

fields = ['id','restaurantId','customerId','date','status','currency','subtotalCents','discountCents','totalCents','paymentStatus','paymentMethod','paidCents','segment','promo','actualMinutes','estimatedMinutes','vehicle','rating','tier','commissionRate','signupConflict','hireConflict','items']
out = []
for o in orders.values():
    key=o['order_id']; p=payments[key]; d=deliveries.get(key); c=customers[o['customer_id']]; v=reviews.get(key); partner=commissions[o['restaurant_id']]
    paid = o['order_status']=='Delivered' and p['payment_status']=='Paid'
    out.append([int(key),o['restaurant_id'],int(o['customer_id']),o['order_ts'][:10],o['order_status'],o['currency'],cents(o['subtotal']),cents(o['discount_amount']),cents(o['total_amount']),p['payment_status'],p['payment_method'],cents(p['amount']) if paid else 0,c['segment'],promotions[o['promo_id']]['promo_name'] if o['promo_id'] else None,float(d['actual_minutes']) if d else None,float(d['estimated_minutes']) if d else None,drivers[d['driver_id']]['vehicle_type'] if d else None,int(v['rating']) if v else None,partner['partner_tier'],float(partner['commission_rate_pct']),o['order_ts'][:10]<c['signup_date'],bool(d and d['pickup_ts'][:10]<drivers[d['driver_id']]['hire_date']),items[key]])
currencies = {}
for currency in sorted({o['currency'] for o in orders.values()}):
    rs=[r for r in out if r[5]==currency]; paid=[r for r in rs if r[4]=='Delivered' and r[9]=='Paid']
    currencies[currency]={'orders':len(rs),'paidOrders':len(paid),'paidCents':sum(r[11] for r in paid),'discountCents':sum(r[7] for r in paid),'cancelled':sum(r[4]=='Cancelled' for r in rs)}
payload = {'metadata':{'label':'Synthetic transaction demonstration','periodStart':min(o['order_ts'][:10] for o in orders.values()),'periodEnd':max(o['order_ts'][:10] for o in orders.values()),'files':{n+'.csv':len(D[n]) for n in names},'moneyUnit':'hundredths of original currency; no conversion','grain':'one row per order; items nested; no multiplied order totals'},'fields':fields,'rows':out,'menus':[[menus[k]['Item_name'], menus[k]['Food_category']] for k in menu_ids],'checks':checks,'baseline':{'orders':len(out),'paidOrders':sum(r[4]=='Delivered' and r[9]=='Paid' for r in out),'cancelled':sum(r[4]=='Cancelled' for r in out),'currencies':currencies}}
target=PROJECT/'public/data/orders.json'
target.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False))
print(json.dumps({'file':str(target),'bytes':target.stat().st_size,'baseline':payload['baseline'],'checks':checks},indent=2))
