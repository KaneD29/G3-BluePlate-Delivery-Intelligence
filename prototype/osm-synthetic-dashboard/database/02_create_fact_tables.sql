USE blueplate_dw;

-- 11. FACT_DELIVERY_PERFORMANCE
CREATE TABLE fact_delivery_performance (
    delivery_fact_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    time_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    zone_key INT NOT NULL,
    platform_key INT NOT NULL,
    source_key INT NOT NULL,
    quoted_eta_min_mins SMALLINT NOT NULL,
    quoted_eta_max_mins SMALLINT NOT NULL,
    estimated_total_delivery_mins DECIMAL(6, 2) NOT NULL, -- Proxy: Routing time + kitchen handoff buffer
    road_transit_mins DECIMAL(6, 2) NOT NULL,
    delivery_fee_php DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    min_order_php DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    is_sla_compliant BOOLEAN NOT NULL DEFAULT TRUE, -- True if <= 35 mins for campus radius
    severity_level ENUM('NORMAL', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'NORMAL',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_deliv_date_rest (date_key, restaurant_key),
    INDEX idx_deliv_severity (severity_level),
    CONSTRAINT fk_deliv_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_deliv_time FOREIGN KEY (time_key) REFERENCES dim_time(time_key),
    CONSTRAINT fk_deliv_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_deliv_zone FOREIGN KEY (zone_key) REFERENCES dim_zone(zone_key),
    CONSTRAINT fk_deliv_plat FOREIGN KEY (platform_key) REFERENCES dim_platform(platform_key),
    CONSTRAINT fk_deliv_src FOREIGN KEY (source_key) REFERENCES dim_data_source(source_key)
) ENGINE=InnoDB;

-- 12. FACT_MENU_PRICE_SNAPSHOT
CREATE TABLE fact_menu_price_snapshot (
    price_fact_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    menu_item_key INT NOT NULL,
    platform_key INT NOT NULL,
    listed_price_php DECIMAL(10, 2) NOT NULL,
    discounted_price_php DECIMAL(10, 2) NOT NULL,
    discount_pct DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    prev_day_price_php DECIMAL(10, 2) NULL,
    price_change_pct DECIMAL(6, 2) NOT NULL DEFAULT 0.00,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    severity_level ENUM('NORMAL', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'NORMAL',
    UNIQUE KEY uk_price_snap (date_key, menu_item_key, platform_key),
    CONSTRAINT fk_price_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_price_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_price_item FOREIGN KEY (menu_item_key) REFERENCES dim_menu_item(menu_item_key),
    CONSTRAINT fk_price_plat FOREIGN KEY (platform_key) REFERENCES dim_platform(platform_key)
) ENGINE=InnoDB;

-- 13. FACT_RESTAURANT_DAILY_METRICS
CREATE TABLE fact_restaurant_daily_metrics (
    rest_metric_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    zone_key INT NOT NULL,
    avg_rating DECIMAL(3, 2) NOT NULL,
    total_review_count INT NOT NULL,
    daily_new_reviews INT NOT NULL DEFAULT 0,
    estimated_order_volume INT NOT NULL DEFAULT 0, -- Demand proxy from review velocity
    avg_menu_price_php DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    scheduled_open_checks TINYINT NOT NULL DEFAULT 1,
    observed_online_checks TINYINT NOT NULL DEFAULT 1,
    availability_uptime_pct DECIMAL(5, 2) NOT NULL DEFAULT 100.00,
    severity_level ENUM('NORMAL', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'NORMAL',
    UNIQUE KEY uk_rest_daily (date_key, restaurant_key),
    CONSTRAINT fk_rdm_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_rdm_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_rdm_zone FOREIGN KEY (zone_key) REFERENCES dim_zone(zone_key)
) ENGINE=InnoDB;

-- 14. FACT_CANCELLATION_PROXY
CREATE TABLE fact_cancellation_proxy (
    cancel_proxy_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    zone_key INT NOT NULL,
    unexpected_offline_flips TINYINT NOT NULL DEFAULT 0,
    out_of_stock_item_ratio DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    cancellation_review_mentions TINYINT NOT NULL DEFAULT 0,
    cancellation_proxy_rate_pct DECIMAL(5, 2) NOT NULL DEFAULT 0.00, -- Composite proxy score
    severity_level ENUM('NORMAL', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'NORMAL',
    UNIQUE KEY uk_cancel_daily (date_key, restaurant_key),
    CONSTRAINT fk_cp_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_cp_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_cp_zone FOREIGN KEY (zone_key) REFERENCES dim_zone(zone_key)
) ENGINE=InnoDB;

-- 15. FACT_REVIEW_SENTIMENT
CREATE TABLE fact_review_sentiment (
    review_fact_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    platform_key INT NOT NULL,
    external_review_hash CHAR(64) NOT NULL UNIQUE, -- SHA-256 deduplication key
    reviewer_rating TINYINT NOT NULL,
    sentiment_score DECIMAL(4, 3) NOT NULL, -- -1.000 to +1.000
    sentiment_label ENUM('POSITIVE', 'NEUTRAL', 'NEGATIVE') NOT NULL,
    detected_issue_tag ENUM('NONE', 'LATE_DELIVERY', 'ORDER_CANCELLED', 'WRONG_OR_MISSING_ITEM', 'HIGH_PRICE', 'FOOD_QUALITY') NOT NULL DEFAULT 'NONE',
    review_excerpt VARCHAR(500) NULL,
    CONSTRAINT fk_rev_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_rev_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_rev_plat FOREIGN KEY (platform_key) REFERENCES dim_platform(platform_key)
) ENGINE=InnoDB;

-- 16. FACT_PROMOTION_TRACKING
CREATE TABLE fact_promotion_tracking (
    promo_fact_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    platform_key INT NOT NULL,
    promo_title VARCHAR(160) NOT NULL,
    discount_pct DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    min_spend_php DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    is_free_delivery BOOLEAN NOT NULL DEFAULT FALSE,
    INDEX idx_promo_date_rest (date_key, restaurant_key),
    CONSTRAINT fk_promo_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_promo_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_promo_plat FOREIGN KEY (platform_key) REFERENCES dim_platform(platform_key)
) ENGINE=InnoDB;

-- 17. FACT_CITY_COVERAGE_SUMMARY
CREATE TABLE fact_city_coverage_summary (
    coverage_fact_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    city_key INT NOT NULL,
    zone_key INT NOT NULL,
    active_restaurant_count INT NOT NULL,
    avg_delivery_mins DECIMAL(6, 2) NOT NULL,
    avg_delivery_fee_php DECIMAL(8, 2) NOT NULL,
    avg_zone_rating DECIMAL(3, 2) NOT NULL,
    avg_cancellation_proxy_pct DECIMAL(5, 2) NOT NULL,
    critical_alert_count INT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_city_zone_cov (date_key, city_key, zone_key),
    CONSTRAINT fk_cov_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_cov_city FOREIGN KEY (city_key) REFERENCES dim_city(city_key),
    CONSTRAINT fk_cov_zone FOREIGN KEY (zone_key) REFERENCES dim_zone(zone_key)
) ENGINE=InnoDB;

-- 18. FACT_ALERT_EVENTS
CREATE TABLE fact_alert_events (
    alert_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    time_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    zone_key INT NOT NULL,
    threshold_key INT NOT NULL,
    observed_value DECIMAL(10, 2) NOT NULL,
    severity_level ENUM('WARNING', 'CRITICAL') NOT NULL,
    alert_message VARCHAR(255) NOT NULL,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_alert_open (is_resolved, severity_level, date_key),
    CONSTRAINT fk_alert_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_alert_time FOREIGN KEY (time_key) REFERENCES dim_time(time_key),
    CONSTRAINT fk_alert_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_alert_zone FOREIGN KEY (zone_key) REFERENCES dim_zone(zone_key),
    CONSTRAINT fk_alert_thresh FOREIGN KEY (threshold_key) REFERENCES dim_alert_threshold(threshold_key)
) ENGINE=InnoDB;

-- 19. FACT_COMPETITOR_BENCHMARK
CREATE TABLE fact_competitor_benchmark (
    benchmark_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    restaurant_key INT NOT NULL,
    cuisine_key INT NOT NULL,
    restaurant_avg_price_php DECIMAL(10, 2) NOT NULL,
    cuisine_peer_avg_price_php DECIMAL(10, 2) NOT NULL,
    price_competitiveness_index DECIMAL(6, 3) NOT NULL, -- 1.000 = at peer average; >1.15 = overpriced vs UST peers
    restaurant_rating DECIMAL(3, 2) NOT NULL,
    cuisine_peer_avg_rating DECIMAL(3, 2) NOT NULL,
    rating_spread DECIMAL(4, 2) NOT NULL,
    UNIQUE KEY uk_bench_daily (date_key, restaurant_key),
    CONSTRAINT fk_bench_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_bench_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_bench_cuis FOREIGN KEY (cuisine_key) REFERENCES dim_cuisine(cuisine_key)
) ENGINE=InnoDB;

-- 20. FACT_ETL_PIPELINE_RUNS
CREATE TABLE fact_etl_pipeline_runs (
    run_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    date_key INT NOT NULL,
    source_key INT NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NOT NULL,
    records_extracted INT NOT NULL DEFAULT 0,
    records_loaded INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    run_status ENUM('SUCCESS', 'PARTIAL_SUCCESS', 'FAILED') NOT NULL,
    log_summary VARCHAR(255) NULL,
    CONSTRAINT fk_etl_date FOREIGN KEY (date_key) REFERENCES dim_date(date_key),
    CONSTRAINT fk_etl_src FOREIGN KEY (source_key) REFERENCES dim_data_source(source_key)
) ENGINE=InnoDB;