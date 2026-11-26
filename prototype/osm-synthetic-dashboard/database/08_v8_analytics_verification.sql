-- Read-only smoke queries after running migration and daily view.
USE blueplate_dw;
SELECT COUNT(*) AS daily_signal_rows FROM vw_v8_restaurant_daily_signals;
SELECT COLUMN_NAME FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'app_manager_annotations'
   AND COLUMN_NAME IN ('action_status', 'alert_id', 'updated_at');
SELECT COLUMN_NAME FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'app_user_reviews'
   AND COLUMN_NAME IN ('submission_source', 'client_submission_id');
