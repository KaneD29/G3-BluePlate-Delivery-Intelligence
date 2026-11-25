-- Apply once to the intended BluePlate warehouse after a verified backup.
ALTER TABLE app_user_reviews
    MODIFY restaurant_key INT NULL,
    ADD COLUMN submitted_restaurant_name VARCHAR(120) NULL,
    ADD COLUMN submitted_restaurant_location VARCHAR(160) NULL,
    ADD COLUMN submitted_restaurant_type VARCHAR(40) NULL,
    ADD COLUMN submitted_location_details VARCHAR(240) NULL,
    ADD COLUMN restaurant_review_status ENUM(
        'PENDING','MATCHED_EXISTING','APPROVED_NEW','DUPLICATE_OR_INVALID','OUTSIDE_STUDY_AREA'
    ) NULL,
    ADD COLUMN restaurant_reviewed_at DATETIME NULL,
    ADD CONSTRAINT chk_user_review_restaurant_identity CHECK (
        (restaurant_review_status IS NULL AND restaurant_key IS NOT NULL
         AND submitted_restaurant_name IS NULL AND submitted_restaurant_location IS NULL
         AND submitted_restaurant_type IS NULL AND submitted_location_details IS NULL
         AND restaurant_reviewed_at IS NULL)
        OR
        (submission_source = 'GUEST' AND restaurant_review_status IS NOT NULL
         AND submitted_restaurant_name IS NOT NULL AND CHAR_LENGTH(TRIM(submitted_restaurant_name)) > 0
         AND submitted_restaurant_location IS NOT NULL AND CHAR_LENGTH(TRIM(submitted_restaurant_location)) > 0
         AND ((restaurant_review_status = 'PENDING' AND restaurant_key IS NULL AND restaurant_reviewed_at IS NULL)
           OR (restaurant_review_status IN ('DUPLICATE_OR_INVALID','OUTSIDE_STUDY_AREA')
               AND restaurant_key IS NULL AND restaurant_reviewed_at IS NOT NULL)
           OR (restaurant_review_status IN ('MATCHED_EXISTING','APPROVED_NEW')
               AND restaurant_key IS NOT NULL AND restaurant_reviewed_at IS NOT NULL)))
    );
