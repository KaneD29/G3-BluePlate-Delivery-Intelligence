/* BluePlate OSM-only synthetic demonstration, v1.
   All numeric performance outputs and reports in this module are fabricated,
   deterministic illustrative data. They are NOT observations and are NEVER
   inserted into MySQL. Venue identities/coordinates come from the live API. */
(() => {
  'use strict';
  function hash(value) {
    let h = 2166136261;
    for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h,16777619); }
    return h >>> 0;
  }
  function metrics(row) {
    const key = String(row.restaurant_key);
    const seed = hash('bp_demo_v1_' + key);
    const eta = +(19 + seed % 260 / 10).toFixed(1);
    const risk = +(2 + (hash(key + '_risk') % 165) / 10).toFixed(1);
    const rating = +(3.35 + (hash(key + '_rating') % 151) / 100).toFixed(2);
    const demand = 15 + (hash(key + '_orders') % 76);
    const health = eta >= 42 || risk >= 15 || rating < 3.7 ? 'CRITICAL'
       : eta >= 34 || risk >= 8 || rating < 4.2 ? 'WARNING' : 'NORMAL';
    return { ...row,
      recorded_rating: row.public_avg_rating ?? null,
      proxy_delivery_mins: eta, cancellation_risk_index: risk,
      blended_rating: rating, public_avg_rating: rating,
      modeled_demand: demand, overall_health_status: health,
      auditor_report_count: 0, observed_delivery_mins: null,
      synthetic_demo: true, data_origin: 'SYNTHETIC DEMONSTRATION — NOT REAL ORDERS, RATINGS OR REVIEWS'
    };
  }
  function trend(range) {
    const from = new Date(range.from + 'T00:00:00Z');
    const to = new Date(range.to + 'T00:00:00Z');
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return [];
    const days = Math.min(90, Math.round((to - from) / 86400000) + 1);
    const start = new Date(to.getTime() - (days - 1) * 86400000);
    return Array.from({length: days}, (_, i) => {
      const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      const h = hash('bp_demo_v1_day_' + day);
      return { report_date: day, modeled_demand: 70 + h % 100,
        proxy_delivery_mins: +(24 + (h % 160) / 10).toFixed(1),
        cancellation_risk_index: +(3 + (h % 125) / 10).toFixed(1),
        public_avg_rating: +(3.65 + (h % 113) / 100).toFixed(2), synthetic_demo: true };
    });
  }
  function alerts(rows, range) {
    const flagged = rows.filter(r => r.overall_health_status !== 'NORMAL')
      .sort((a,b) => b.cancellation_risk_index - a.cancellation_risk_index).slice(0, 6);
    return flagged.map((r,i) => ({alert_id: 800000 + i, restaurant_key:r.restaurant_key,
      restaurant_name: r.restaurant_name, zone_name: r.zone_name,
      severity_level: r.overall_health_status === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
      alert_message: `SYNTHETIC DEMO: Illustrative ETA ${r.proxy_delivery_mins} min, risk index ${r.cancellation_risk_index}% and rating ${r.blended_rating}/5. Not a real operational alert.`,
      created_at: range.to + 'T10:00:00', workflow_status:'MODEL SIGNAL',
      synthetic_demo:true }));
  }
  function reports(restaurants) {
    const notes = ['Sample only: smooth pickup near campus gate.', 'Sample only: delivery took longer than estimated.',
      'Sample only: food packaging was intact.', 'Sample only: rider found the designated pickup area.',
      'Sample only: preparation delay during lunch.', 'Sample only: order was delivered as expected.'];
    return restaurants.slice(0, Math.min(6, restaurants.length)).map((r,i) => ({
      user_review_id: 'synthetic-' + i, restaurant_key:r.id, restaurant_name:r.name,
      zone_name:r.zone, order_was_cancelled:false,
      rating_score:3 + hash('bp_report_'+r.id)%3,
      actual_observed_delivery_mins:22 + hash('bp_mins_'+r.id)%28,
      comment_text:notes[i], submission_source:'SYNTHETIC SAMPLE',
      submitted_at:new Date(Date.now() - i * 86400000).toISOString(), synthetic_demo:true
    }));
  }
  window.BluePlateSynthetic = Object.freeze({metrics, trend, alerts, reports});
})();
