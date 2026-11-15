CREATE DATABASE IF NOT EXISTS blueplate_dw
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE blueplate_dw;

-- 1. DIM_DATE
CREATE TABLE dim_date (
    date_key INT PRIMARY KEY, -- Format: YYYYMMDD
    full_date DATE NOT NULL UNIQUE,
    day_of_week TINYINT NOT NULL, -- 1=Monday .. 7=Sunday
    day_name VARCHAR(12) NOT NULL,
    week_of_year TINYINT NOT NULL,
    month_num TINYINT NOT NULL,
    month_name VARCHAR(12) NOT NULL,
    quarter_num TINYINT NOT NULL,
    year_num SMALLINT NOT NULL,
    is_weekend BOOLEAN NOT NULL DEFAULT FALSE,
    is_ph_holiday BOOLEAN NOT NULL DEFAULT FALSE,
    ust_academic_period ENUM('Regular Semester', 'Prelims/Finals Exam Week', 'Campus Event/Paskuhan', 'Term Break') NOT NULL DEFAULT 'Regular Semester'
) ENGINE=InnoDB;

-- 2. DIM_TIME
CREATE TABLE dim_time (
    time_key INT PRIMARY KEY, -- Format: HHMM (e.g., 1200)
    hour_24 TINYINT NOT NULL,
    minute_of_hour TINYINT NOT NULL,
    time_slot_label VARCHAR(20) NOT NULL,
    meal_period ENUM('Breakfast (06-10)', 'Lunch Rush (11-14)', 'Merienda (15-17)', 'Dinner Rush (18-21)', 'Late Night (22-05)') NOT NULL,
    is_peak_hour BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;

-- 3. DIM_CITY
CREATE TABLE dim_city (
    city_key INT AUTO_INCREMENT PRIMARY KEY,
    city_name VARCHAR(80) NOT NULL,
    region_name VARCHAR(80) NOT NULL DEFAULT 'Metro Manila (NCR)',
    country_code CHAR(2) NOT NULL DEFAULT 'PH',
    population_est INT NULL,
    is_primary_hub BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_city_region (city_name, region_name)
) ENGINE=InnoDB;

-- 4. DIM_ZONE (Micro-locations around UST & Metro Manila)
CREATE TABLE dim_zone (
    zone_key INT AUTO_INCREMENT PRIMARY KEY,
    city_key INT NOT NULL,
    zone_code VARCHAR(25) NOT NULL UNIQUE,
    zone_name VARCHAR(100) NOT NULL, -- e.g., 'UST - España Blvd', 'UST - Dapitan St', 'UST - P. Noval St', 'UST - Lacson Ave'
    barangay_name VARCHAR(100) NULL,
    center_lat DECIMAL(10, 7) NOT NULL,
    center_lng DECIMAL(10, 7) NOT NULL,
    radius_km DECIMAL(5, 2) NOT NULL DEFAULT 1.50,
    nearest_ust_gate VARCHAR(60) NULL,
    CONSTRAINT fk_zone_city FOREIGN KEY (city_key) REFERENCES dim_city(city_key)
) ENGINE=InnoDB;

-- 5. DIM_CUISINE
CREATE TABLE dim_cuisine (
    cuisine_key INT AUTO_INCREMENT PRIMARY KEY,
    cuisine_name VARCHAR(60) NOT NULL UNIQUE,
    cuisine_group VARCHAR(60) NOT NULL, -- e.g., 'Filipino Comfort', 'Beverages & Cafe', 'East Asian', 'Western Fast Food'
    avg_prep_baseline_mins TINYINT NOT NULL DEFAULT 12
) ENGINE=InnoDB;

-- 6. DIM_PLATFORM
CREATE TABLE dim_platform (
    platform_key INT AUTO_INCREMENT PRIMARY KEY,
    platform_name VARCHAR(60) NOT NULL UNIQUE, -- e.g., 'Google Places API', 'Foodpanda Public', 'GrabFood Public', 'OpenStreetMap'
    platform_type ENUM('Directory API', 'Delivery Marketplace', 'Open Geo Data') NOT NULL,
    base_url VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- 7. DIM_DATA_SOURCE (Compliance & ETL Lineage)
CREATE TABLE dim_data_source (
    source_key INT AUTO_INCREMENT PRIMARY KEY,
    source_code VARCHAR(40) NOT NULL UNIQUE,
    collection_method ENUM('Official REST API', 'Overpass Geo Query', 'Rate-Limited Legal Bot') NOT NULL,
    tos_compliance_notes VARCHAR(255) NOT NULL,
    rate_limit_seconds DECIMAL(4, 2) NOT NULL DEFAULT 3.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 8. DIM_RESTAURANT
CREATE TABLE dim_restaurant (
    restaurant_key INT AUTO_INCREMENT PRIMARY KEY,
    external_place_id VARCHAR(128) NOT NULL UNIQUE, -- Google Place ID or canonical OSM/storefront hash
    restaurant_name VARCHAR(160) NOT NULL,
    branch_label VARCHAR(100) NULL, -- e.g., 'The One Torre de Santo Tomas', 'Dapitan'
    zone_key INT NOT NULL,
    primary_cuisine_key INT NOT NULL,
    street_address VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    distance_to_ust_km DECIMAL(5, 3) NOT NULL,
    price_level TINYINT NULL COMMENT '1=Budget (<=150 PHP), 2=Moderate (151-350 PHP), 3=Mid-High (351-700 PHP), 4=Premium (>700 PHP)',
    opening_time TIME NULL,
    closing_time TIME NULL,
    is_24_hours BOOLEAN NOT NULL DEFAULT FALSE,
    operational_status ENUM('OPERATIONAL', 'TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED') NOT NULL DEFAULT 'OPERATIONAL',
    first_seen_date DATE NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rest_zone (zone_key),
    INDEX idx_rest_cuisine (primary_cuisine_key),
    INDEX idx_rest_distance (distance_to_ust_km),
    CONSTRAINT fk_rest_zone FOREIGN KEY (zone_key) REFERENCES dim_zone(zone_key),
    CONSTRAINT fk_rest_cuisine FOREIGN KEY (primary_cuisine_key) REFERENCES dim_cuisine(cuisine_key)
) ENGINE=InnoDB;

-- 9. DIM_MENU_ITEM (SCD Type 2 for Historical Price Tracking)
CREATE TABLE dim_menu_item (
    menu_item_key INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_key INT NOT NULL,
    platform_key INT NOT NULL,
    item_natural_id VARCHAR(120) NOT NULL,
    item_name VARCHAR(180) NOT NULL,
    menu_category VARCHAR(80) NOT NULL DEFAULT 'Main Menu',
    current_price_php DECIMAL(10, 2) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    INDEX idx_menu_rest_current (restaurant_key, is_current),
    UNIQUE KEY uk_menu_scd (restaurant_key, platform_key, item_natural_id, effective_from),
    CONSTRAINT fk_menu_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_menu_platform FOREIGN KEY (platform_key) REFERENCES dim_platform(platform_key)
) ENGINE=InnoDB;

-- 10. DIM_ALERT_THRESHOLD (Normal / Warning / Critical Rules Engine)
CREATE TABLE dim_alert_threshold (
    threshold_key INT AUTO_INCREMENT PRIMARY KEY,
    metric_code VARCHAR(50) NOT NULL UNIQUE, -- e.g., 'DELIVERY_ETA_MINS', 'CANCELLATION_PROXY_PCT', 'AVG_RATING', 'PRICE_HIKE_PCT'
    metric_label VARCHAR(100) NOT NULL,
    unit_label VARCHAR(20) NOT NULL,
    comparison_direction ENUM('HIGHER_IS_WORSE', 'LOWER_IS_WORSE') NOT NULL,
    normal_limit DECIMAL(10, 2) NOT NULL,
    warning_limit DECIMAL(10, 2) NOT NULL,
    critical_limit DECIMAL(10, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;