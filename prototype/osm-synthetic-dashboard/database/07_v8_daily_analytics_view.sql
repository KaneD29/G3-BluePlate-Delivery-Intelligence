-- Re-runnable daily BI view for real date-range analysis (not fabricated history).
-- On dates without collected signals, metric values remain NULL.
USE blueplate_dw;

CREATE OR REPLACE VIEW vw_v8_restaurant_daily_signals AS
SELECT
    rdm.date_key,
    d.full_date AS report_date,
    rdm.restaurant_key,
    rdm.zone_key,
    rdm.avg_rating AS public_avg_rating,
    rdm.total_review_count,
    rdm.daily_new_reviews,
    rdm.estimated_order_volume AS modeled_demand,
    rdm.avg_menu_price_php,
    dp.estimated_delivery_mins AS proxy_delivery_mins,
    cp.cancellation_proxy_rate_pct AS cancellation_risk_index,
    rdm.severity_level AS rating_health,
    dp.delivery_health,
    cp.severity_level AS cancellation_health
FROM fact_restaurant_daily_metrics rdm
JOIN dim_date d ON d.date_key = rdm.date_key
LEFT JOIN (
    SELECT date_key, restaurant_key,
           ROUND(AVG(estimated_total_delivery_mins), 2) AS estimated_delivery_mins,
           CASE
             WHEN SUM(severity_level = 'CRITICAL') > 0 THEN 'CRITICAL'
             WHEN SUM(severity_level = 'WARNING') > 0 THEN 'WARNING'
             ELSE 'NORMAL'
           END AS delivery_health
    FROM fact_delivery_performance
    GROUP BY date_key, restaurant_key
) dp ON dp.date_key = rdm.date_key AND dp.restaurant_key = rdm.restaurant_key
LEFT JOIN fact_cancellation_proxy cp
    ON cp.date_key = rdm.date_key AND cp.restaurant_key = rdm.restaurant_key;
