-- Additive. Apply in the validated warehouse schema with the approved snapshot loader.
CREATE TABLE dim_bi_model_version (
    model_version VARCHAR(64) PRIMARY KEY,
    metric_family ENUM('LEGACY_DAILY','DELIVERY_SCENARIO') NOT NULL,
    description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE bi_model_publication (
    date_key INT NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    audited_snapshot_sha256 CHAR(64) NOT NULL,
    audit_model_version VARCHAR(64) NOT NULL UNIQUE,
    published_at TIMESTAMP NOT NULL,
    display_metadata JSON NOT NULL,
    PRIMARY KEY (date_key,model_version),
    FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    FOREIGN KEY (model_version) REFERENCES dim_bi_model_version(model_version),
    FOREIGN KEY (audit_model_version) REFERENCES bi_model_snapshot(model_version)
) ENGINE=InnoDB;

CREATE TABLE fact_bi_restaurant_scenario (
    date_key INT NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    restaurant_key INT NOT NULL,
    distance_m DOUBLE NOT NULL,
    distance_zone ENUM('A','B','C','OUTSIDE') NOT NULL,
    eta_low_min DOUBLE NULL,
    eta_high_min DOUBLE NULL,
    transit_stress_points DOUBLE NULL,
    demand_low DOUBLE NOT NULL,
    demand_base DOUBLE NOT NULL,
    demand_high DOUBLE NOT NULL,
    cancellation_probability DOUBLE NULL,
    legacy_comparison_points DOUBLE NULL,
    overall_delivery_risk DOUBLE NULL,
    price_provenance VARCHAR(32) NOT NULL,
    observed_price_php DECIMAL(12,2) NULL,
    estimated_price_low_php DECIMAL(12,2) NULL,
    estimated_price_high_php DECIMAL(12,2) NULL,
    reviewed_attributes JSON NOT NULL,
    PRIMARY KEY (date_key,model_version,restaurant_key),
    FOREIGN KEY (date_key,model_version) REFERENCES bi_model_publication(date_key,model_version),
    FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CHECK (eta_low_min IS NULL OR eta_high_min >= eta_low_min),
    CHECK (transit_stress_points IS NULL OR transit_stress_points BETWEEN 0 AND 100)
) ENGINE=InnoDB;

CREATE VIEW vw_bi_modeled_restaurant_day AS
SELECT v.date_key, v.report_date, v.restaurant_key, 'legacy-osm-daily-v1' AS model_version,
       v.zone_key, v.public_avg_rating, v.total_review_count, v.daily_new_reviews,
       v.modeled_demand, v.avg_menu_price_php, v.proxy_delivery_mins, v.cancellation_risk_index,
       v.rating_health, v.delivery_health, v.cancellation_health,
       NULL AS distance_m, NULL AS distance_zone, NULL AS eta_low_min, NULL AS eta_high_min,
       NULL AS transit_stress_points, NULL AS demand_low, NULL AS demand_base, NULL AS demand_high,
       NULL AS cancellation_probability, NULL AS legacy_comparison_points,
       NULL AS overall_delivery_risk, NULL AS price_provenance, NULL AS observed_price_php,
       NULL AS estimated_price_low_php, NULL AS estimated_price_high_php
FROM vw_v8_restaurant_daily_signals v
UNION ALL
SELECT f.date_key, d.full_date, f.restaurant_key, f.model_version,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       f.distance_m, f.distance_zone, f.eta_low_min, f.eta_high_min,
       f.transit_stress_points, f.demand_low, f.demand_base, f.demand_high,
       f.cancellation_probability, f.legacy_comparison_points,
       f.overall_delivery_risk, f.price_provenance, f.observed_price_php,
       f.estimated_price_low_php, f.estimated_price_high_php
FROM fact_bi_restaurant_scenario f
JOIN dim_date d USING (date_key);

CREATE VIEW vw_bi_analytical_date AS
SELECT date_key, report_date, model_version, COUNT(*) AS modeled_venues
FROM vw_bi_modeled_restaurant_day
GROUP BY date_key,report_date,model_version;
