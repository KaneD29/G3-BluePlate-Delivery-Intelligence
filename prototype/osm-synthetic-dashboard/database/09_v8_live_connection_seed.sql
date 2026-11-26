-- BluePlate V8 local development optional seed. Review and back up first.
-- This file NEVER creates/promotes a manager account or enables authentication.
-- If manager access is needed, provision a distinct user through an audited,
-- authenticated administration workflow rather than promoting user_id=1.
USE blueplate_dw;

-- Preserve zone labels expected by the existing frontend demo.
UPDATE dim_zone SET zone_name='UST - España Blvd' WHERE zone_code='UST-ESPANA';
UPDATE dim_zone SET zone_name='UST - Dapitan St' WHERE zone_code='UST-DAPITAN';
UPDATE dim_zone SET zone_name='UST - P. Noval St' WHERE zone_code='UST-PNOVAL';
UPDATE dim_zone SET zone_name='UST - Lacson Ave' WHERE zone_code='UST-LACSON';

-- Adds a missing lunch time slot without modifying an existing row's privileges.
INSERT INTO dim_time (time_key, hour_24, minute_of_hour, time_slot_label, meal_period, is_peak_hour)
VALUES (1200,12,0,'12:00 PM','Lunch Rush (11-14)',TRUE)
ON DUPLICATE KEY UPDATE time_key=time_key;
