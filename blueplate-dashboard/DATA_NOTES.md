# BluePlate data notes

The dashboard asset is generated from the eleven original CSVs audited on November 8, 2026. Source files are read only. The separate Orders & Revenue section now uses ten additional synthetic CSVs; see SYNTHETIC_DATA_NOTES.md. These records do not change the original snapshot calculations documented here.

## Rebuild

Run `python scripts/prepare-data.py --source-dir /absolute/path/to/source-csvs` with Python and pandas. The script writes `public/data/blueplate.json`, verifies the full global baseline, and independently verifies Delhi as a filtered example. Its default input location is the accompanying `blueplate-review/data` directory in this workspace.

## Payload

- `metadata`: labels, preparation time, null source/snapshot observation date, price-history date span, per-file row counts, interpretation notes.
- `restaurants`: 5,000 unique string IDs with location, cuisine, rating, reviews, business status, chain/local, delivery capability, nullable delivery-metric availability, price and delivery metrics. Metric field names: `deliveryTime`, `estimatedTime`, `overrun`, `cancellation`, `feeBurden`, `peakMultiplier`, `priceDeviation`. Country currencies are retained without conversion.
- `cities`: 10 cities with country, population, supplied coverage, restaurant count and matching SQL city aggregates.
- `priceChanges`: 18,887 events with deterministic numeric `id`, `menuId`, item, restaurant, location, currency, timestamp, current/previous price, and absolute `changePct` rounded to two decimals.
- `thresholds`: 12 records using `id`, `name`, `unit`, `direction`, `normal`, `warning`. Direction is `LOWER_IS_BETTER` or `HIGHER_IS_BETTER`.
- `alerts`: 36,391 records with deterministic numeric `id`, `kpiId`, scope, location, optional restaurant/menu references, measured `value`, severity, and date. Scope is `CITY`, `RESTAURANT`, `MENU_ITEM`, or `GLOBAL`; only `WARNING` and `CRITICAL` records are stored. Undated snapshot alerts have null dates. Menu alerts derive their city/country through the restaurant, fixing the original SQL insert's missing direct city link for UI filtering.
- `checks`: 11 dataset-wide checks with `id`, name, source table, `scope: GLOBAL`, total, valid, failed and integrity percentage. Geographic filters do not alter these checks.
- `baseline`: verified global KPI results; `verification.Delhi` contains the independent geographic example.

## Interpretation

Source snapshot observation dates are not supplied. Preparation and audit dates are not observation dates. Price-history timestamps run from January 1 to December 30, 2023. Do not fabricate monthly operational trends from the undated snapshot.

Delivery metrics apply to 3,187 restaurants. The 1,813 other restaurants retain null delivery measures, rather than zero-minute deliveries or zero cancellation rates. Availability is the share whose delivery-metrics `Availability` field is true within the delivery-metrics population; delivery capability across all restaurants is a different measure.

Ratios and calculated fact metrics mirror the supplied SQL, including two-decimal, half-up rounding before aggregate calculations. Delivery fee burden is total fees divided by average menu price. Cancellation rate is a restaurant-level average, not cancelled orders divided by orders. Price deviation uses each restaurant's city benchmark from the full source snapshot. Filtering selects records; it does not change that benchmark. City coverage remains the supplied city statistic.

Alerts count violations across different metrics and scopes. Their total is not a count of unique restaurants or current incidents. There are 25,813 critical and 10,578 warning records. The 18,887 menu-price records are historical; the remaining 17,504 are city/restaurant snapshot violations. All eleven implemented source checks pass, which does not imply every possible data-quality rule was checked.

## Verified controls

Global: 5,000 restaurants; 55.54-minute mean delivery time; 4.98% cancellation; 49.67% availability; 3.50 rating; 64.72% low-rated; 40.73% price deviation; 20.43% fee burden; 1.75× peak multiplier; 78.55% city coverage; 36,391 alerts; 100% integrity across 11 implemented checks.

Delhi, India: 509 restaurants; 325 delivery-metric records; 54.83-minute mean delivery time; 5.36% cancellation; 3.47 rating; 53.54% availability. No NaN or Infinity is allowed in the serialized JSON.
