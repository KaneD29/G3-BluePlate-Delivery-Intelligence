# BluePlate versioned analytical warehouse

## Before and after

The November 15, 2026 analysis joins legacy daily restaurant, delivery and cancellation facts through vw_v8_restaurant_daily_signals. It has 123 restaurant fact rows and 119 operational venues in the historical dashboard. The November 25, 2026 scenario was originally served by reading the complete restaurant array from bi_model_snapshot. Both used the same stable restaurant keys and the canonical dashboard, but their analytical reads were separate.

Now both use vw_bi_modeled_restaurant_day, with vw_bi_analytical_date providing the date and model catalog. The legacy view is unchanged and feeds the compatibility arm. The new arm joins typed scenario facts to dim_date and references the existing dim_restaurant keys. bi_model_snapshot is the immutable audit artifact and exact approved CSV source. Flask reconstructs current analytical restaurant rows from typed facts. Date filters use the same dashboard component and preserve legacy reporting contracts.

## Grain and migration

database/13_versioned_bi.sql adds dim_bi_model_version, bi_model_publication, fact_bi_restaurant_scenario and the two semantic views. The typed scenario fact grain is one row per analytical date, methodology version and restaurant key. A publication links its date and methodology to the exact audit snapshot and digest. The date dimension has one additional analytical date. No legacy fact tables, views or columns were replaced.

Scenario facts hold distance band, Haversine meters, double-precision ETA endpoints, transit stress, three hypothetical daily allocations, and nullable cancellation probability, overall risk and pricing fields. Reviewed display attributes such as address, name, operating provenance and independent street labels are attached to the fact at publication. Legacy point ETA, stipulated order counts and cancellation-index points retain their own fields. Unsupported values remain null. Student reports are stored separately and counted using source GUEST; report text is excluded from the modeled endpoints.

## Lineage and append flow

The reviewed OSM cohort is already represented by stable restaurant keys and the reviewed directory overlay. A future approved update must reconcile the reviewed directory and publish an audited version first. The versioned loader then checks the artifact SHA-256, audit metadata and exact approved ID/key membership, adds or reuses the warehouse date and version, and appends the typed publication and facts in one transaction. The common views expose the new slice without a new dashboard or a normal ETL reload. External OSM refresh remains disabled. This step integrates the existing approved model only and performs no discovery or additional modeling.

## Dates and geography

Warehouse Data As Of is the maximum published analytical date. Latest genuine report is the maximum guest submission timestamp. Directory updated is the latest recorded directory publication timestamp. Both timestamps are reported in Manila time. The browser separately records its refresh time, and the toolbar shows which analytical date or report period is selected.

The zone dialog illustrates three concentric distance bands around UST. Counts are computed from the selected population. Current bands use the reviewed Haversine values, and the earlier view classifies its available stored distances for the explanatory counts. Historical corridor labels and current street filters are separate. Bands are straight-line boundaries around the reference point, not roads or administrative borders.

The ETA formula, transit stress and hypothetical demand assumptions remain those approved in Step 7.15J.5. The legacy risk and demand measures are retained in date mode and are not plotted against the current measures as one series.

## Student dashboard reporting periods

Latest available selects the newest published analytical snapshot through today in Manila and all genuine GUEST reports submitted through today. An explicit inclusive date range selects exactly one estimate series, the most recent published snapshot inside that range. If multiple methods exist on its latest day, the published delivery scenario takes precedence. This selection avoids combining estimates across methodologies. Reports are aggregated independently for the inclusive Manila dates. A period with no applicable model keeps the current options searchable and reports its estimate fields as unavailable. An earlier date with the legacy model may show its original point ETA; it has no Transit Stress Index value.

Headline estimates use the arithmetic mean of each eligible scenario endpoint and the arithmetic mean of the Transit Stress Index. Reported delivery averages include completed reports with 1–240 recorded minutes. Student rating averages include ratings from 1 to 5, including any rating attached to a canceled order. Student report counts and distinct venues are limited to genuine GUEST submissions. Each displayed reported average carries its own sample size.

The order demand simulation remains a separate chart with the approved 1,500, 3,000 and 4,500 daily pools, equally allocated across the selected current model. The CSV export uses the chosen analytical snapshot and retains its original bytes. Historical HTTP/CSV contracts remain available independently of these presentation-period selection rules.

## Dashboard visualization and delivery notices

The estimated delivery time card uses the original warehouse ETA planning thresholds. A value below 35 minutes is in the green band, 35 to under 45 minutes is amber, and 45 minutes or more is red. The current card classifies its mean higher ETA endpoint. Earlier snapshots with only a point estimate use that estimate. These bands are planning guides and do not describe observed performance. The original 28-minute normal reference is retained in the warehouse. The former cancellation index limits do not apply to the current Transit Stress Index. Travel difficulty and both student-reported averages stay neutral. Student delivery duration and rating both retain their own sample counts.

The ETA chart's floating bars connect zone-level averages of the faster and slower endpoints. These endpoints come from deterministic delivery assumptions. The zone donut shows the selected population, and its counts and percentages appear in the legend. The travel difficulty chart retains its 0–100 scale. The demand chart stacks zone allocations of the chosen hypothetical daily pool. Zone colors identify distance bands only. Small student samples are shown as averages and counts. Cuisine chart labels format OSM tags for display, while counts still use the original tag groups.

Delivery notices use selected estimates and student reports. The longer-time advisory requires an estimate of at least 35 minutes; the travel advisory requires the modeled travel budget to be reached. Directory publication is a dated update and may summarize previously public venues hidden after confirmed closure. The date refers to the directory update and does not assert a closure observation date or permanence. Student feedback coverage uses the distinct reported restaurant count. Raw warehouse alerts remain in historical storage and the existing reporting APIs. This section does not infer real-time platform activity.

## Reviewed cuisine display dimension

The current reviewed directory carries a cuisine annotation keyed by the existing restaurant identity. It preserves the original OSM cuisine and amenity values, then records separate establishment type, cuisine regions, food specialties, display label and evidence source. Tagged cuisine groups take precedence; explicit reviewed specialty names and selected recognizable chain references fill some gaps. Broad regional-only tags and ambiguous names can remain Not specified. An establishment type such as Café does not assign a cuisine.

The historical cuisine dimension and its preparation fields still feed the historical view. The current reviewed classification does not alter preparation, ETA, transit stress, demand, identities, or the approved snapshot. The current CSV adds classification fields while the audit CSV is available with the audit=1 query parameter.

## Unlisted delivery reports

The original guest report ID, UUID, text, experience and Manila timestamp remain in app_user_reviews. Pending restaurant identities have a NULL foreign key and a separate pending count. They do not appear in the public feed, restaurant or zone metrics, or ordinary report exports. Outside-area, duplicate or invalid outcomes preserve the report and stay separate. A canonical match adds the existing restaurant key without moving the original submission date or generating a modeled fact. Matched reports can therefore contribute to actual reported aggregates for their original submission date.

Review privately using tools/review_unlisted_reports.py with an authorized MySQL account and --expected-server-uuid. Omit --report to list pending entries. Use --report ID --outcome MATCHED_EXISTING --restaurant-key KEY to link an existing approved, in-radius venue. For APPROVED_NEW, complete the separate human-reviewed directory publication first and supply its approved directory-only key. The review command does not publish a business. Use DUPLICATE_OR_INVALID or OUTSIDE_STUDY_AREA without a key. Leave unreviewed reports pending. Keep terminal outputs private. The submission UUID remains valid for receipt replay after review.
