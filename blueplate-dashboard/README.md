# BluePlate Delivery Intelligence

A working eight-section BI capstone dashboard, built from the supplied BluePlate CSV data and warehouse definitions. Includes Overview, Delivery Analytics, Restaurants, Pricing Intelligence, City Intelligence, Orders & Revenue, KPI Alerts, and Data Quality.

## Use

Choose a country and city to recalculate the dashboard. Search, filter, sort and paginate the restaurant directory, then open a restaurant for details. Pricing includes a 2023 history period filter. KPI Alerts includes severity, scope, KPI and text filters. Export data downloads all matching table records as CSV, not just the visible page. Data Quality always covers the full source dataset.

The user requested public access for this release. The live dashboard uses the same hosted URL and needs no custom domain.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm run install:ci
npm run dev
```

Open the Local URL printed by the development server. The prepared datasets are included at public/data/blueplate.json and public/data/orders.json; no database or Drive sign-in is needed for local data loading.

```sh
npm run build
```

The production build targets the included Vinext/Cloudflare Worker setup. Keep its Sites build integration when deploying on Sites. A different host needs an appropriate build/runtime configuration; this is not a standalone index.html package.

## Data and scope

The app contains 5,000 restaurants, 3,187 delivery-metric records, 10 cities, 18,887 dated price-change records, 36,391 generated KPI breaches, 12 thresholds, and 11 integrity checks. Country and city filters recompute the relevant measures from underlying records. It is a snapshot dashboard, not a live database connection.

Source snapshot date is unknown. Price history is from 2023. Orders & Revenue adds 64,000 synthetic 2023 orders using all ten synthetic files. The 100% core integrity result covers only the original 11 checks. The synthetic section reports 16 separate checks, including 2,701 orders before customer signup and 853 deliveries before driver hire. Monetary amounts remain separated by their original currencies. Read DATA_NOTES.md and SYNTHETIC_DATA_NOTES.md for definitions, data regeneration and limitations. CANVA_UPDATE_GUIDE.md contains the change summary and values for updating the design.

## Verification

```sh
node --experimental-strip-types scripts/check-dashboard.mjs
node --experimental-strip-types scripts/check-orders.mjs
npx tsc --noEmit
```

Verified global figures include 55.54-minute average delivery time, 4.98% average cancellation, 49.67% availability, 3.50 restaurant rating, and 36,391 breaches (25,813 critical, 10,578 warning). Delhi, India verifies 509 restaurants, 54.83-minute delivery, 5.36% cancellation, and 53.54% availability. February 2023 has 1,391 price-change records.

Browser checks covered geographic filters, all seven sections, restaurant search, an empty search, sorting, pagination, detail dialogs, a 31-record CSV download, historical date filters, alert scope filtering, dataset-wide validation, and the mobile menu. The 390-pixel layout has no document-level horizontal overflow; wide data tables scroll inside their panels.

## Sources

- Dataset: https://drive.google.com/drive/folders/1yVJfzbshfNBNp0fSGo0P5fkm1GC9eEpM
- Warehouse SQL: https://drive.google.com/drive/folders/1JW3yoD-V-Fj8owdpI85zTU2Q2SNMuAO4
- Canva reference: https://www.canva.com/design/DAHYYYyaEmM/t5bSY-fTypQhsxdOb4esBw/edit

Original source files and the synced project sources were not changed.

## Orders & Revenue verification

Independent checks reconcile all five currency totals, ten city totals and sixty country-month totals. The original dashboard baseline still passes. Browser checks cover the new page, inclusive dates, market filters, cancelled-order exclusion, currency chart switching, pagination, empty search, export controls, separate validation checks, and 390px/1440px responsive layouts. A synthetic validation CSV download was confirmed.
