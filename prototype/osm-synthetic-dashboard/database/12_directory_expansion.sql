-- Apply through a verified isolated migration runner after 01–07.
ALTER TABLE dim_restaurant MODIFY operational_status
  ENUM('OPERATIONAL','TEMPORARILY_CLOSED','PERMANENTLY_CLOSED','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  ADD directory_provenance ENUM('OSM_LISTED','USER_CONFIRMED','INDEPENDENTLY_VERIFIED')
    NOT NULL DEFAULT 'OSM_LISTED',
  ADD confirmed_on DATE NULL,
  ADD publication_status ENUM('APPROVED','PENDING','HOLD','EXCLUDED') NOT NULL DEFAULT 'PENDING',
  ADD osm_opening_hours VARCHAR(255) NULL,
  ADD bi_scope ENUM('LEGACY','DIRECTORY_ONLY') NOT NULL DEFAULT 'DIRECTORY_ONLY',
  ADD guest_reporting_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD withdrawn_at DATETIME NULL,
  ADD identity_hold BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE directory_publication_batch (
  cohort_sha256 CHAR(64) PRIMARY KEY,
  approval_sha256 CHAR(64) NOT NULL,
  backup_sha256 CHAR(64) NOT NULL,
  committed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE directory_publication_entry (
  cohort_sha256 CHAR(64) NOT NULL,
  restaurant_key INT NOT NULL UNIQUE,
  external_place_id VARCHAR(128) NOT NULL UNIQUE,
  PRIMARY KEY (cohort_sha256,restaurant_key),
  FOREIGN KEY (cohort_sha256) REFERENCES directory_publication_batch(cohort_sha256),
  FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW vw_ust_restaurant_bi_overview AS
SELECT
    r.restaurant_key,
    r.restaurant_name,
    r.branch_label,
    z.zone_name,
    c.city_name,
    cu.cuisine_name,
    r.distance_to_ust_km,
    r.operational_status,
    rdm.avg_rating AS public_avg_rating,
    COALESCE(ur.user_avg_rating, rdm.avg_rating) AS blended_rating,
    rdm.estimated_order_volume,
    rdm.availability_uptime_pct,
    dp.estimated_total_delivery_mins AS proxy_delivery_mins,
    ur.avg_actual_delivery_mins AS user_verified_delivery_mins,
    cp.cancellation_proxy_rate_pct,
    CASE
        WHEN cp.severity_level = 'CRITICAL' OR dp.severity_level = 'CRITICAL' OR rdm.severity_level = 'CRITICAL' THEN 'CRITICAL'
        WHEN cp.severity_level = 'WARNING' OR dp.severity_level = 'WARNING' OR rdm.severity_level = 'WARNING' THEN 'WARNING'
        ELSE 'NORMAL'
    END AS overall_health_status,
    d.full_date AS report_date
FROM dim_restaurant r
JOIN dim_zone z ON r.zone_key = z.zone_key
JOIN dim_city c ON z.city_key = c.city_key
JOIN dim_cuisine cu ON r.primary_cuisine_key = cu.cuisine_key
LEFT JOIN fact_restaurant_daily_metrics rdm
    ON r.restaurant_key = rdm.restaurant_key
    AND rdm.date_key = (SELECT MAX(date_key) FROM fact_restaurant_daily_metrics)
LEFT JOIN fact_delivery_performance dp
    ON r.restaurant_key = dp.restaurant_key
    AND dp.date_key = rdm.date_key
LEFT JOIN fact_cancellation_proxy cp
    ON r.restaurant_key = cp.restaurant_key
    AND cp.date_key = rdm.date_key
LEFT JOIN dim_date d ON rdm.date_key = d.date_key
LEFT JOIN (
    SELECT
        restaurant_key,
        ROUND(AVG(rating_score), 2) AS user_avg_rating,
        ROUND(AVG(actual_observed_delivery_mins), 2) AS avg_actual_delivery_mins
    FROM app_user_reviews
    GROUP BY restaurant_key
) ur ON r.restaurant_key = ur.restaurant_key
WHERE r.bi_scope='LEGACY';

CREATE TABLE rc_publication_control (
  id INT PRIMARY KEY CHECK (id=1),
  server_uuid CHAR(36) NOT NULL,
  owner_key_sha256 CHAR(64) NOT NULL,
  backup_sha256 CHAR(64) NOT NULL
) ENGINE=InnoDB;
