USE blueplate_dw;

-- Unified Dashboard View combining automated ETL facts + user-submitted ground-truth reviews
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
) ur ON r.restaurant_key = ur.restaurant_key;

-- Active Alerts Feed for Flask Topbar / Notification Center
CREATE OR REPLACE VIEW vw_active_alerts_dashboard AS
SELECT
    a.alert_id,
    d.full_date AS alert_date,
    t.time_slot_label,
    r.restaurant_name,
    z.zone_name,
    th.metric_label,
    a.observed_value,
    th.unit_label,
    a.severity_level,
    a.alert_message,
    COALESCE(ack.action_status, 'UNACKNOWLEDGED') AS workflow_status,
    u.username AS assigned_manager
FROM fact_alert_events a
JOIN dim_date d ON a.date_key = d.date_key
JOIN dim_time t ON a.time_key = t.time_key
JOIN dim_restaurant r ON a.restaurant_key = r.restaurant_key
JOIN dim_zone z ON a.zone_key = z.zone_key
JOIN dim_alert_threshold th ON a.threshold_key = th.threshold_key
LEFT JOIN app_alert_acknowledgements ack ON a.alert_id = ack.alert_id
LEFT JOIN app_users u ON ack.user_id = u.user_id
WHERE a.is_resolved = FALSE
ORDER BY FIELD(a.severity_level, 'CRITICAL', 'WARNING'), a.created_at DESC;