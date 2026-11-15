/* BluePlate V8 local Flask + MySQL bridge.
   No browser-accessible manager secret. Demo hosting is read-only/static.
   This file only activates when the *same origin* serves the local Flask API. */
(() => {
  'use strict';
  const app = window.BluePlateApp;
  if (!app) return;
  const page = document.body.dataset.page;
  let revision = 0;
  let guestEnabled = false;
  let demoEnabled = false;
  let demoRestaurants = [];

  async function request(path, opts = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store',
      headers: {'Accept': 'application/json', ...(opts.body ? {'Content-Type': 'application/json'} : {})},
      ...opts
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data.message || `HTTP ${response.status}`).slice(0,200));
    return data;
  }
  function numberOrNull(value) {
    return value === null || value === undefined || value === '' ? null :
      (Number.isFinite(Number(value)) ? Number(value) : null);
  }
  function dateOnly(value) { return typeof value === 'string' ? value.slice(0, 10) : ''; }
  function qrange(range) {
    return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  }
  function restaurant(row) {
    const distance = numberOrNull(row.distance_to_ust_km);
    const zone = String(row.zone_name || 'Unassigned zone');
    const name = String(row.restaurant_name || 'Unnamed restaurant');
    const branch = String(row.branch_label || row.street_address || 'UST Manila');
    const price = numberOrNull(row.avg_menu_price_php);
    return {
      id: Number(row.restaurant_key), name, branch, zone,
      externalPlaceId: String(row.external_place_id || ''),
      streetAddress: String(row.street_address || ''),
      branchLabel: String(row.branch_label || ''),
      cuisine: String(row.cuisine_name || 'Unclassified'),
      nearestGate: distance === null ? 'Distance unavailable' : `${zone.replace('UST - ', '')} (${distance.toFixed(2)} km)`,
      distance,
      priceRange: price === null ? 'Price unavailable' : `₱${price.toFixed(0)} modeled average`,
      avgPricePhp: price,
      proxyDeliveryMins: numberOrNull(row.proxy_delivery_mins),
      cancellationProxyPct: numberOrNull(row.cancellation_risk_index),
      publicRating: numberOrNull(row.blended_rating ?? row.public_avg_rating),
      verified: numberOrNull(row.observed_delivery_mins),
      orderCount: numberOrNull(row.modeled_demand),
      reportCount: Number(row.auditor_report_count || 0),
      health: String(row.overall_health_status || 'UNKNOWN'),
      syntheticDemo: row.synthetic_demo === true,
      recordedRating: numberOrNull(row.recorded_rating),
      userReviews: []
    };
  }
  // Suppress only demonstrable repeated listings, never same-brand branches at
  // different addresses. A missing address is NOT enough to merge restaurants.
  function uniqueRestaurants(rows) {
    const normalize = value => String(value || '').normalize('NFKC')
      .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const ids = new Set(), placeIds = new Set(), locations = new Set(), output = [];
    for (const row of rows) {
      if (!Number.isInteger(row.id) || row.id < 1 || !row.name.trim()) continue;
      if (ids.has(row.id)) continue;
      const place = row.externalPlaceId.trim();
      const address = normalize(row.streetAddress);
      const locationKey = address ? [normalize(row.name), address,
        normalize(row.zone), normalize(row.branchLabel)].join('|') : '';
      if ((place && placeIds.has(place)) || (locationKey && locations.has(locationKey))) continue;
      ids.add(row.id);
      if (place) placeIds.add(place);
      if (locationKey) locations.add(locationKey);
      output.push(row);
    }
    return output;
  }
  async function refreshAdmin(range) {
    const id = ++revision;
    const query = qrange(range);
    try {
      const [ov, alerts, trends] = await Promise.all([
        request(`/api/dashboard/overview?${query}`),
        demoEnabled ? Promise.resolve({alerts: []}) : request(`/api/dashboard/alerts?${query}`),
        demoEnabled ? Promise.resolve({days: []}) : request(`/api/dashboard/trends?${query}`)
      ]);
      if (id !== revision) return;
      if (!Array.isArray(ov.restaurants) || !Array.isArray(alerts.alerts) || !Array.isArray(trends.days)) {
        throw new Error('The Flask API returned an unexpected response format');
      }
      const preview = demoEnabled ? ov.restaurants.map(window.BluePlateSynthetic.metrics) : ov.restaurants;
      const displayAlerts = demoEnabled ? window.BluePlateSynthetic.alerts(preview, range) : alerts.alerts;
      const displayTrend = demoEnabled ? window.BluePlateSynthetic.trend(range) : trends.days;
      app.setAdmin({
        demo: demoEnabled,
        restaurants: uniqueRestaurants(preview.map(restaurant)),
        alerts: displayAlerts.map(a => ({
          id: Number(a.alert_id),
          restaurant: String(a.restaurant_name || 'Unknown restaurant'),
          zone: String(a.zone_name || 'Unknown zone'),
          severity: String(a.severity_level || 'WARNING'),
          message: String(a.alert_message || ''),
          timestamp: dateOnly(a.created_at) || 'Date unavailable',
          status: a.workflow_status === 'UNACKNOWLEDGED' ? 'OPEN' : String(a.workflow_status || 'OPEN'),
          modeled: a.synthetic_demo === true
        })),
        trend: displayTrend.map(d => ({
          date: dateOnly(d.report_date),
          orders: numberOrNull(d.modeled_demand),
          eta: numberOrNull(d.proxy_delivery_mins),
          risk: numberOrNull(d.cancellation_risk_index),
          rating: numberOrNull(d.public_avg_rating)
        })).filter(d => /^\d{4}-\d\d-\d\d$/.test(d.date))
      });
    } catch (err) {
      if (id === revision) app.showError(err.message);
      throw err;
    }
  }
  async function refreshPublicReviews() {
    if (demoEnabled) {
      app.setPublicReviews(window.BluePlateSynthetic.reports(demoRestaurants));
      return;
    }
    const data = await request('/api/user/reviews?limit=12');
    if (!Array.isArray(data.reviews)) throw new Error('Unexpected reviews response');
    app.setPublicReviews(data.reviews);
  }
  async function submitReport(payload) {
    if (!guestEnabled) throw new Error('Guest reports are disabled pending anti-abuse controls');
    return request('/api/user/reviews', {method: 'POST', body: JSON.stringify(payload)});
  }
  async function restaurantDetail(id, range) {
    return request(`/api/restaurants/${encodeURIComponent(id)}?${qrange(range)}`);
  }
  function downloadCsv(which, range) {
    if (which === 'reports') {
      app.notice('CSV export of auditor report text requires manager authentication. Restaurant data remains available.');
      return;
    }
    if (which !== 'restaurants') return;
    window.location.assign(`/api/exports/restaurants.csv?${qrange(range)}`);
  }
  window.BluePlateBridge = {refreshAdmin, refreshPublicReviews, submitReport, restaurantDetail, downloadCsv};

  async function initialize() {
    try {
      const health = await request('/api/health');
      if (health.service !== 'blueplate-local-flask') return;
    } catch (_) {
      // GitHub Pages/Google Sites only serve a static demo. No data API is implied.
      return;
    }
    try {
      const session = await request('/api/session');
      // /api/session MUST NOT return a token. It only describes configured features.
      guestEnabled = session.guest_reports_enabled === true;
      demoEnabled = session.synthetic_demo_enabled === true;
      if (demoEnabled && !window.BluePlateSynthetic) throw new Error("Synthetic module missing");
      app.activateLive({guestEnabled, demoEnabled});
      if (page === 'admin') {
        await refreshAdmin(app.getRange());
      } else if (page === 'public') {
        const all = [];
        let offset = 0;
        do {
          const data = await request(`/api/restaurants?limit=100&offset=${offset}`);
          if (!Array.isArray(data.restaurants)) throw new Error('Unexpected restaurants response');
          all.push(...data.restaurants);
          const next = data.next_offset;
          if (next !== null && (!Number.isInteger(next) || next <= offset)) throw new Error('Invalid directory pagination');
          offset = next;
        } while (offset !== null);
        demoRestaurants = uniqueRestaurants(all.map(restaurant));
        app.setPublic(demoRestaurants);
        await refreshPublicReviews();
      }
    } catch (err) {
      app.showError(err.message);
      console.error('[BluePlate] Local database synchronization failed:', err);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
