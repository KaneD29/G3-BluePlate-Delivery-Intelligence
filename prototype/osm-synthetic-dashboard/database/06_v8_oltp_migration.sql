-- BluePlate V8 local Flask/MySQL schema alignment.
-- APPLY ONCE after 01-05, with a verified backup, to the blueplate_dw schema.
-- Not the reviewed AWS deployment migration format; do not put this in deploy/migrations/.
USE blueplate_dw;

-- Guest feedback never accepts an arbitrary user_id from a public client.
-- Existing user-linked reports remain linked; new guest reports store NULL.
ALTER TABLE app_user_reviews
    MODIFY COLUMN user_id INT NULL,
    ADD COLUMN submission_source ENUM('GUEST', 'AUTHENTICATED')
        NOT NULL DEFAULT 'AUTHENTICATED' AFTER user_id,
    ADD COLUMN client_submission_id CHAR(36) NULL AFTER comment_text,
    ADD UNIQUE INDEX uk_review_client_submission (client_submission_id),
    ADD INDEX idx_user_review_time (submitted_at, restaurant_key);

-- Keep every legacy category value so this migration does not rewrite older notes.
-- New categories match the V8 Manager Action Log labels through the API mapping.
ALTER TABLE app_manager_annotations
    MODIFY COLUMN category ENUM(
        'WEATHER_FLOOD', 'CAMPUS_EVENT', 'MERCHANT_AUDIT',
        'PRICING_ACTION', 'OTHER',
        'DELIVERY_DELAY', 'PICKUP_ISSUE', 'TRAFFIC',
        'RESTAURANT_ISSUE', 'CUSTOMER_FEEDBACK', 'GENERAL_OBSERVATION'
    ) NOT NULL DEFAULT 'OTHER',
    MODIFY COLUMN note_text VARCHAR(600) NOT NULL,
    ADD COLUMN action_status ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED')
        NOT NULL DEFAULT 'OPEN' AFTER category,
    ADD COLUMN alert_id BIGINT NULL AFTER restaurant_key,
    ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
    ADD INDEX idx_manager_action_status (action_status, created_at),
    ADD INDEX idx_manager_action_alert (alert_id),
    ADD CONSTRAINT fk_manager_action_alert FOREIGN KEY (alert_id)
        REFERENCES fact_alert_events(alert_id) ON DELETE SET NULL;

-- The original collector assigned every place cuisine_key=1 (Filipino).
-- Preserve uncertainty instead of misclassifying every merchant.
INSERT INTO dim_cuisine (cuisine_name, cuisine_group, avg_prep_baseline_mins)
VALUES ('Unclassified / Pending Review', 'Unknown', 12)
ON DUPLICATE KEY UPDATE cuisine_name = VALUES(cuisine_name);
