# BluePlate coded dashboard: use and checks

Public dashboard: https://blueplate-delivery-intelligence.rlsdpunzalan.chatgpt.site

This is the existing coded website dashboard, with eight pages and the supplied snapshot plus synthetic records. No Tableau workbook is required. It calculates interactive views from bundled data; it is not connected to a live database.

## Use now

1. Open the public URL in a private/incognito browser window to check visitor access.
2. Use the sidebar to open Overview, Delivery Analytics, Restaurants, Pricing Intelligence, City Intelligence, Orders & Revenue, KPI Alerts and Data Quality.
3. Choose Country/City, use the page-specific controls, and export matching table rows as CSV.

## Acceptance checklist

- Global Overview: delivery 55.54 minutes, cancellation 4.98%, rating 3.50, availability 49.67%.
- India / Delhi: 509 restaurants, delivery 54.83 minutes, cancellation 5.36%, availability 53.54%.
- Restaurants: test search, empty search, sorting, pagination and a restaurant detail dialog. Clear search afterward.
- Pricing: February 2023 contains 1,391 historical price-change events. Dates do not turn snapshot cards into monthly trends.
- Alerts: 36,391 breaches; 25,813 critical and 10,578 warning. Search/severity/scope controls narrow the table.
- Orders: 64,000 synthetic orders, 60,762 paid delivered orders, 3,238 cancelled orders, 5.06% cancellation.
- Orders: choose Cancelled only; paid spend should be zero. Reset before further checks.
- Orders: Brazil, February 2023: 920 orders, 865 paid, 55 cancelled; BRL 239,044.03 paid spend and BRL 276.35 average paid order.
- Money: keep USD, GBP, INR, JPY and BRL separate; there is no combined-currency revenue total.
- Export: verify an exported CSV contains all matching records, including records beyond the current table page.
- Quality: 11 original checks pass; 14 of 16 synthetic checks pass. The 2,701 signup conflicts and 853 driver-hire conflicts remain flagged. Their sum is not a unique bad-order count.
- Mobile: check navigation, readable charts, and table scrolling.

## Checks rerun November 11, 2026

Original snapshot controls: PASS. Synthetic controls across five currencies, ten cities and sixty country-month selections: PASS. TypeScript check: PASS. Hosting tool confirms active/public publication. These are not tests of a production data-generation pipeline.

## Source package

The source ZIP contains the tracked dashboard application and prepared JSON datasets. See README.md for local setup and DATA_NOTES.md / SYNTHETIC_DATA_NOTES.md for definitions. Original CSVs remain in the shared project/Drive. Source-regeneration scripts need those original inputs; running the supplied dashboard does not.

Local setup uses Node.js 22.13 or newer: npm run install:ci, then npm run dev. Production deployment uses the included Vinext/Cloudflare setup; a different host needs corresponding runtime configuration.

## Remaining professor requirements

The dashboard requirement is fulfilled by this coded application. The data-generation website, complete source-system schema/migrations, and a tested production generator-to-dashboard pipeline are separate remaining work. The current Data & methodology dialog links the original Warehouse SQL. Those SQL references do not establish a working generator or production database.

Give Leo the source ZIP, this checklist, the SQL/data references and local setup instructions. Do not claim live refresh: Drive changes do not automatically update the bundled datasets.
