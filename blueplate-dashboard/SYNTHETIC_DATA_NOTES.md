# Synthetic orders and revenue notes

Added November 10, 2026. The original seven sections and restaurant-snapshot calculations remain available. Orders & Revenue is an eighth section with a separate transaction population. Source CSV files are never modified.

## Inputs

All ten synthetic CSVs are used, with the original restaurant, menu and country tables providing context:

| File | Rows | Use |
|---|---:|---|
| orders.csv | 64,000 | One record per order, date, status, currency, fees, discounts and totals |
| order_items.csv | 159,945 | Units, top menu items and merchandise line values |
| payments.csv | 64,000 | Paid customer spend, payment methods, refunded/voided values |
| deliveries.csv | 60,762 | Completed order-to-delivery durations and driver links |
| customers.csv | 20,000 | Distinct ordering customers, supplied segments and signup-date validation |
| customer_reviews.csv | 24,329 | Order-linked ratings and review coverage |
| drivers.csv | 1,500 | Delivery vehicle mix and hire-date validation |
| promotions.csv | 8 | Promotion names and active-date validation |
| restaurant_commissions.csv | 5,000 | Partner-tier filter and commission-rate coverage validation; no commission revenue is inferred |
| restaurant_operating_hours.csv | 35,000 | Restaurant and weekday reference checks; weekday numbering is undocumented |

These are supplied synthetic demonstration records, not measured live business transactions. Orders span January 1–December 31, 2023. Source timestamps do not include time-zone offsets. Reviews can be dated through January 3, 2024; review analytics select by the associated order date.

## Definitions

- **Paid customer spend:** sum payment amount only where order status is Delivered and payment status is Paid. The amounts include fees and are already net of recorded discounts. This is not platform profit or an accounting revenue ledger.
- **Average paid order:** paid customer spend divided by the same paid delivered order population, within the same currency and filters.
- **Cancellation:** cancelled orders divided by all selected orders. This intentionally differs from the restaurant-average cancellation figure on Overview.
- **Delivery time:** average actual_minutes for paid completed deliveries. This is order-to-delivery duration, not pickup-to-drop-off travel time.
- **Refunded/voided values:** original order values with the respective payment status, excluded from paid customer spend. These values do not imply additional negative sales.
- **Top menu items:** sum quantities for each unique menu item on paid orders; retain distinct source lines even when an order contains a menu item more than once. Item sales exclude order-level discounts and fees. Ties are resolved by stable menu index.
- **Payment mix:** paid order counts by method. Counts can span countries; monetary amounts cannot be combined across currencies.
- **Customers:** distinct supplied synthetic customer identifiers among selected orders. Supplied customer segments are labels, not a lifecycle calculation.
- **Promotion usage:** orders with a promotion divided by all selected orders. Usage does not estimate causal uplift.
- **Reviews:** average order-linked review rating; coverage is reviewed orders divided by paid delivered orders.

All monetary arithmetic uses integer hundredths of the source currency. USD, GBP, INR, JPY and BRL remain separate. The UI preserves two decimals for the supplied JPY records, even though these synthetic records contain fractional yen.

Country/city come from the order's restaurant. Market, date, order-status, payment-method, customer-segment and partner-tier filters update all measures on Orders & Revenue. Dates are inclusive calendar dates. Search changes only the order table and its CSV export. The monthly paid-spend chart requires one currency. Validation is dataset-wide.

## Validation and limitations

Fourteen of sixteen implemented synthetic checks pass. Financial values reconcile exactly to source cents, and the checked foreign-key relationships hold. Independent controls cover five currencies, ten cities and sixty country-month combinations.

- 2,701 orders predate customer signup.
- 853 deliveries predate driver hire.

These records remain in the demonstration totals and carry visible flags in the explorer and export. Customer acquisition and driver tenure are not analyzed. The counts may overlap at order level; their sum is not a unique affected-order count. Source dates are not rewritten or imputed.

Operating-hours checks validate restaurant links and weekday values. The source does not define weekday numbering; the UI does not claim an open-hours compliance result. A passed check does not imply real-world truth or validate every possible business rule.

## Rebuild and checks

Run `python3 scripts/prepare-orders.py --source-dir /absolute/path/to/source-csvs`. This creates `public/data/orders.json`. The file is loaded when Orders & Revenue or Data Quality is opened. There is no live Google Drive refresh.

Run `node --experimental-strip-types scripts/check-orders.mjs`. The controls in `scripts/order-controls.json` were independently calculated from the source CSVs. Run the existing `scripts/check-dashboard.mjs` to verify original measures.

Baseline: 64,000 orders; 60,762 paid delivered orders; 3,238 cancellations (5.06%); 55.56-minute mean fulfillment; 19,196 ordering customers; 303,471 paid units; 24,329 reviews averaging 3.47/5; 5,000 promotion orders (4,751 paid).

| Currency | Paid customer spend | Paid orders | Average paid order |
|---|---:|---:|---:|
| BRL | 3,276,310.41 | 11,760 | 278.60 |
| GBP | 3,584,775.40 | 12,730 | 281.60 |
| INR | 3,325,038.61 | 11,748 | 283.03 |
| JPY | 3,590,227.03 | 12,521 | 286.74 |
| USD | 3,459,137.64 | 12,003 | 288.19 |

Source folder: https://drive.google.com/drive/folders/1-e2TtUUbkA0DxWajqau511dUD-QUknF4
