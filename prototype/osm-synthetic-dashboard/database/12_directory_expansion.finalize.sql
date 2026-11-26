-- Apply after exact legacy ID backfill.
ALTER TABLE dim_restaurant
  ADD CONSTRAINT chk_rc_directory_provenance CHECK (bi_scope='LEGACY' OR
    ((directory_provenance='OSM_LISTED' AND confirmed_on IS NULL AND operational_status='UNKNOWN')
      OR (directory_provenance<>'OSM_LISTED' AND confirmed_on IS NOT NULL)));
