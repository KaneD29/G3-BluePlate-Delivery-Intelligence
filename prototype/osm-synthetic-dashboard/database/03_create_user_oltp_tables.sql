USE blueplate_dw;

-- ============================================================================
-- USER / STAKEHOLDER OLTP TABLES (Writable by Flask Web App, NOT by ETL Bot)
-- ============================================================================

-- 21. APP_USERS
CREATE TABLE app_users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(60) NOT NULL UNIQUE,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('ADMIN', 'BI_MANAGER', 'OPERATIONS_ANALYST', 'CAMPUS_AUDITOR') NOT NULL DEFAULT 'BI_MANAGER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 22. APP_USER_REVIEWS (Manual Mystery-Shopper / Student / Manager Test Orders)
CREATE TABLE app_user_reviews (
    user_review_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    restaurant_key INT NOT NULL,
    actual_observed_delivery_mins SMALLINT NULL, -- Ground-truth calibration for proxy ETA!
    order_was_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    rating_score TINYINT NOT NULL CHECK (rating_score BETWEEN 1 AND 5),
    comment_text TEXT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_urev_rest (restaurant_key),
    CONSTRAINT fk_urev_user FOREIGN KEY (user_id) REFERENCES app_users(user_id),
    CONSTRAINT fk_urev_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key)
) ENGINE=InnoDB;

-- 23. APP_MANAGER_ANNOTATIONS (Stakeholder Operational Context Notes)
CREATE TABLE app_manager_annotations (
    annotation_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    restaurant_key INT NULL,
    zone_key INT NULL,
    target_date DATE NOT NULL,
    category ENUM('WEATHER_FLOOD', 'CAMPUS_EVENT', 'MERCHANT_AUDIT', 'PRICING_ACTION', 'OTHER') NOT NULL DEFAULT 'OTHER',
    note_text VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ann_user FOREIGN KEY (user_id) REFERENCES app_users(user_id),
    CONSTRAINT fk_ann_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CONSTRAINT fk_ann_zone FOREIGN KEY (zone_key) REFERENCES dim_zone(zone_key)
) ENGINE=InnoDB;

-- 24. APP_ALERT_ACKNOWLEDGEMENTS (Incident Resolution Workflow)
CREATE TABLE app_alert_acknowledgements (
    ack_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_id BIGINT NOT NULL UNIQUE,
    user_id INT NOT NULL,
    action_status ENUM('ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE') NOT NULL DEFAULT 'ACKNOWLEDGED',
    resolution_notes VARCHAR(500) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ack_alert FOREIGN KEY (alert_id) REFERENCES fact_alert_events(alert_id),
    CONSTRAINT fk_ack_user FOREIGN KEY (user_id) REFERENCES app_users(user_id)
) ENGINE=InnoDB;

-- 25. APP_WATCHLIST (Personalized Manager Dashboard Pins)
CREATE TABLE app_watchlist (
    watchlist_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    restaurant_key INT NOT NULL,
    custom_label VARCHAR(80) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_watch (user_id, restaurant_key),
    CONSTRAINT fk_watch_user FOREIGN KEY (user_id) REFERENCES app_users(user_id),
    CONSTRAINT fk_watch_rest FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key)
) ENGINE=InnoDB;