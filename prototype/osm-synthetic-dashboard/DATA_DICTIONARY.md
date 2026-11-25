# Data dictionary

| Relation | Grain / purpose |
|---|---|
| dim_restaurant | One persistent key per restaurant identity; the seed contains 123 legacy rows plus 199 additions |
| revised_directory_review | One overlay per warehouse restaurant with reviewed display metadata, visibility, eligibility and sanitized decision provenance |
| dim_date | One local analytical date per date key |
| fact_restaurant_daily_metrics | Original day and restaurant grain |
| fact_delivery_performance | Historical date, time, restaurant, platform and source grain |
| fact_cancellation_proxy | Historical date and restaurant grain |
| dim_bi_model_version | One methodology identifier |
| bi_model_publication | One audited versioned analytical date |
| fact_bi_restaurant_scenario | One date, model version and restaurant. Typed ETA endpoints, zone, stress and demand shares |
| vw_bi_modeled_restaurant_day | Shared semantic view, preserving the separate model fields |
| bi_model_snapshot | Audited version metadata and approved CSV bytes |
| app_user_reviews | Submitted observations. The public seed contains zero rows |

The current facts leave unsupported pricing and cancellation fields null. Legacy closed records retain their warehouse keys. Public visibility, guest-report eligibility and historical membership are separate.

The current logical cuisine dimension lives in the reviewed overlay. Its original tags, reviewed display labels, establishment type, specialties and evidence are separate from historical dim_cuisine keys.
