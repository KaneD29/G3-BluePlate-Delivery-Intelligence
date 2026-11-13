# BluePlate Canva update guide

Updated November 10, 2026. Dashboard: https://blueplate-delivery-intelligence.rlsdpunzalan.chatgpt.site

## What changed

1. Added **Orders & Revenue**, bringing the dashboard to eight sections. It uses all ten synthetic CSVs for transaction analysis, enrichment or validation.
2. Added monthly order and single-currency paid-spend charts, a currency-separated spend table, payment methods, customer segments, vehicle mix, top menu items, promotion usage and order-review summaries.
3. Added order-date, order-status, payment-method, customer-segment and partner-tier filters alongside country/city selections.
4. Added searchable, paginated order records, visible chronology flags and a CSV export of all matching orders.
5. Extended **Data Quality** with 16 synthetic-data checks, separate from the original 11 snapshot checks, and added validation CSV export.
6. Updated **Data & methodology** to explain synthetic records, payment eligibility, currencies, filter behavior and date limitations.

The original restaurant snapshot figures still use their original formulas. Source CSVs were not edited. The Canva design itself has not been edited.

## New Canva screen: Orders & Revenue

Insert the screen after City Intelligence, and add **Orders & Revenue** to the navigation on your mockups. Keep the same navy sidebar, light panels and blue accents.

**Title:** Orders & Revenue

**Subtitle:** Explore synthetic order activity, paid customer spend, and customer and delivery patterns.

**Data badge:** SYNTHETIC DATA · JANUARY–DECEMBER 2023

### Top KPI cards — all countries, all dates, all statuses

| Card | Value | Supporting caption |
|---|---:|---|
| Total orders | 64,000 | 19,196 ordering customers |
| Paid delivered orders | 60,762 | 303,471 menu-item units |
| Order cancellation rate | 5.06% | 3,238 cancelled ÷ 64,000 orders |
| Order-to-delivery time | 55.56 min | Mean across completed deliveries |

### Paid customer spend table

| Currency | Paid customer spend | Average paid order |
|---|---:|---:|
| BRL | 3,276,310.41 | 278.60 |
| GBP | 3,584,775.40 | 281.60 |
| INR | 3,325,038.61 | 283.03 |
| JPY | 3,590,227.03 | 286.74 |
| USD | 3,459,137.64 | 288.19 |

Use the heading **Paid customer spend**, not an unlabeled total revenue. Do not add these currencies together. The figures include fees and recorded discounts, exclude refunded and voided orders, and do not represent platform profit. Preserve two decimals, including the supplied fractional JPY values.

### Charts and supporting figures

- **Monthly order activity:** Jan 5,445; Feb 4,874; Mar 5,403; Apr 5,238; May 5,489; Jun 5,339; Jul 5,482; Aug 5,398; Sep 5,341; Oct 5,397; Nov 5,166; Dec 5,428. The interactive version can switch to paid spend for a selected currency.
- **Payment methods:** E-Wallet 20,278 (33.4%); Card 20,244 (33.3%); Cash 20,240 (33.3%) of paid delivered orders.
- **Customer segments:** Regular 41,653 orders; New 16,218; Premium 6,129. These are supplied labels.
- **Vehicle mix:** Motorbike 20,692; Bicycle 20,347; Car 19,723 completed deliveries.
- **Order reviews:** 3.47/5 from 24,329 reviews; 40.0% of paid orders have a review.
- **Promotions:** 5,000 orders used a promotion (7.81%); 4,751 were paid and delivered.
- **Top items:** rank by quantities on paid delivered orders and keep the restaurant name beside each item.

Suggested compact layout: four KPI cards at the top; monthly activity and payment-method charts underneath; a paid-spend table and small customer/promotion callouts below. The live dashboard includes the full explorer and additional panels, which can be split across another Canva screen if needed.

## Update the existing Data Quality screen

Keep the existing result but label it **Core snapshot integrity: 100% across 11 implemented checks**.

Add a separate block:

**Synthetic transaction validation**

**14 of 16 checks passed; 2 chronology checks require review.**

- 2,701 orders occur before the customer's signup date.
- 853 deliveries occur before the driver's hire date.
- These records remain included and flagged; customer acquisition and driver tenure are not analyzed.
- Checked order-line totals, subtotals, payment amounts and relationships reconcile.

Do not describe the combined dataset as having no issues. The two affected-record counts can overlap and should not be added as a unique incident count.

## Copy-ready methodology caption

BluePlate combines the original restaurant snapshot with a separate synthetic transaction dataset covering January–December 2023. Orders & Revenue analyzes 64,000 orders and 60,762 paid completed deliveries. Paid customer spend includes fees and recorded discounts and excludes refunded and voided orders. Currency totals are presented separately. Known signup and driver-hire date conflicts remain flagged in the dataset. Original snapshot KPIs retain their existing definitions; the dashboard is a prepared data snapshot, not a live transaction feed.

## Files added to the dashboard's inputs

orders.csv, order_items.csv, payments.csv, deliveries.csv, customers.csv, customer_reviews.csv, drivers.csv, promotions.csv, restaurant_commissions.csv and restaurant_operating_hours.csv. Commissions supplies partner tiers and validation, not booked revenue; operating hours supplies reference checks rather than an open-hours compliance score.

The original eleven CSVs remain in use. The original warehouse SQL continues to define the snapshot KPIs; the new transaction calculations are documented separately in SYNTHETIC_DATA_NOTES.md.
