-- Apply only to the verified disposable restore after migration 12.
CREATE TABLE revised_directory_review (
    restaurant_key INT PRIMARY KEY,
    display_name VARCHAR(160) NOT NULL,
    display_address VARCHAR(255) NULL,
    operating_status VARCHAR(48) NOT NULL,
    verification_provenance VARCHAR(32) NOT NULL,
    public_visible BOOLEAN NOT NULL,
    guest_eligible BOOLEAN NOT NULL,
    review_evidence JSON NOT NULL,
    FOREIGN KEY (restaurant_key) REFERENCES dim_restaurant(restaurant_key),
    CHECK (NOT guest_eligible OR public_visible)
) ENGINE=InnoDB;

CREATE VIEW revised_directory AS
SELECT d.restaurant_key, d.external_place_id, d.branch_label, d.zone_key,
       d.primary_cuisine_key, d.distance_to_ust_km, d.bi_scope, d.withdrawn_at,
       d.confirmed_on, d.osm_opening_hours, a.display_name AS restaurant_name,
       a.display_address AS street_address, a.operating_status AS operational_status,
       a.verification_provenance AS directory_provenance,
       a.public_visible, a.guest_eligible AS guest_reporting_enabled
FROM dim_restaurant d JOIN revised_directory_review a USING (restaurant_key);
