/* BluePlate V8 local Flask + MySQL bridge.
   No browser-accessible manager secret. Demo hosting is read-only/static.
   This file only activates when the *same origin* serves the local Flask API. */
(() => {
  'use strict';
  const app = window.BluePlateApp;
  if (!app) return;
  const page = document.body.dataset.page;
  const liveRequired = document.body.dataset.liveRequired === 'true';
  let revision = 0;
  let coverageRevision = 0;
  let guestEnabled = false;
  let demoEnabled = false;
  let demoRestaurants = [];
  let challengeWidget;

  async function request(path, {headers, ...opts} = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store',
      headers: {'Accept': 'application/json', ...(opts.body ? {'Content-Type': 'application/json'} : {}), ...headers},
      ...opts
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(data.message || `HTTP ${response.status}`).slice(0, 200));
      error.status = response.status;
      error.retryAfter = Number(response.headers?.get('Retry-After')) || 0;
      throw error;
    }
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
    const address = String(row.street_address || '').trim();
    const hasAddress = address && !['address not recorded in osm', 'sampaloc, manila'].includes(address.toLowerCase());
    const branch = String(row.branch_label || (hasAddress ? address : ''));
    const price = numberOrNull(row.avg_menu_price_php);
    return {
      id: Number(row.restaurant_key), name, branch, zone,
      externalPlaceId: String(row.external_place_id || ''),
      streetAddress: hasAddress ? address : '',
      branchLabel: String(row.branch_label || ''),
      cuisine: String(row.cuisine_name || 'Unclassified'),
      nearestGate: distance === null ? 'Distance unavailable' : `${zone.replace('UST - ', '')} (${distance.toFixed(2)} km)`,
      distance,
      priceRange: price === null ? 'Price unavailable' : `₱${price.toFixed(0)} modeled average`,
      avgPricePhp: price,
      proxyDeliveryMins: numberOrNull(row.proxy_delivery_mins),
      cancellationProxyPct: numberOrNull(row.cancellation_risk_index),
      publicRating: numberOrNull(row.public_avg_rating),
      selfReportedRating: numberOrNull(row.auditor_avg_rating),
      warehouseRatingDays: Number(row.warehouse_rating_days || 0),
      reportRatingCount: Number(row.report_rating_count || 0),
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
      if (!Array.isArray(ov.restaurants) || !Array.isArray(alerts.alerts) || !Array.isArray(trends.days) ||
          (!demoEnabled && !Number.isInteger(ov.report_totals?.auditor_report_count))) {
        throw new Error('The Flask API returned an unexpected response format');
      }
      const preview = demoEnabled ? ov.restaurants.map(window.BluePlateSynthetic.metrics) : ov.restaurants;
      const displayAlerts = demoEnabled ? window.BluePlateSynthetic.alerts(preview, range) : alerts.alerts;
      const displayTrend = demoEnabled ? window.BluePlateSynthetic.trend(range) : trends.days;
      app.setAdmin({
        demo: demoEnabled,
        hasObservations: trends.days.length > 0 ||
          Number(ov.report_totals?.auditor_report_count) > 0,
        reportTotals: ov.report_totals,
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
  async function refreshDashboard(allowDefault = false) {
    if (!demoEnabled) {
      const pending = ++coverageRevision;
      const initialRevision = revision;
      let warehouseDate, reportDate;
      try {
        const coverage = await request('/api/dashboard/coverage');
        const dates = [coverage.latest_reporting_date, coverage.latest_report_submission_date];
        if (coverage.status !== 'ok' || dates.some(date => date !== null &&
            (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date)))) {
          throw new Error('Unexpected reporting coverage response');
        }
        [warehouseDate, reportDate] = dates;
      } catch (err) {
        console.warn('[BluePlate] Reporting coverage unavailable:', err);
      }
      if (pending !== coverageRevision) return;
      const periodUnchanged = initialRevision === revision;
      const before = app.getRange();
      app.setReportingCoverage(warehouseDate, reportDate, allowDefault && periodUnchanged);
      const after = app.getRange();
      // A newer request already loaded this range unless freshness advanced it.
      if (!periodUnchanged && before.from === after.from && before.to === after.to) return;
    }
    return refreshAdmin(app.getRange());
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
  function configureChallenge({site_key, action}) {
    const form = document.getElementById('audit-form');
    const panel = document.createElement('div');
    panel.textContent = 'Loading report verification…';
    form.querySelector('[type="submit"]').before(panel);
    const unavailable = () => {
      panel.textContent = 'Report verification is unavailable. Reload the page to try again.';
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onerror = unavailable;
    script.onload = () => {
      try {
        panel.textContent = '';
        challengeWidget = window.turnstile.render(panel, {sitekey: site_key, action});
      } catch (_) {
        unavailable();
      }
    };
    document.head.append(script);
  }
  async function submitReport(payload) {
    if (!guestEnabled || demoEnabled) throw new Error('Guest reports are disabled');
    const capabilities = await request('/api/session');
    if (capabilities.guest_reports_enabled !== true || !capabilities.guest_form_token) {
      throw new Error('Guest reports are disabled');
    }
    if (liveRequired || capabilities.guest_challenge) {
      const token = challengeWidget != null && window.turnstile?.getResponse(challengeWidget);
      if (!token) throw new Error('Complete the report verification challenge first.');
      payload = {...payload, challenge_response: token};
    }
    try {
      return await request('/api/user/reviews', {
        method: 'POST',
        headers: {'X-BluePlate-Form-Token': capabilities.guest_form_token},
        body: JSON.stringify(payload)
      });
    } finally {
      // Provider tokens expire and are single-use. The submission UUID remains stable.
      if (challengeWidget != null) {
        try {
          window.turnstile.reset(challengeWidget);
        } catch (_) {
          // A widget error must not replace an accepted report receipt.
          challengeWidget = undefined;
        }
      }
    }
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
  window.BluePlateBridge = {refreshAdmin, refreshDashboard, refreshPublicReviews, submitReport, restaurantDetail, downloadCsv};

  async function initialize() {
    if (liveRequired && page === 'admin') {
      document.getElementById('simulate-refresh').onclick = initialize;
    }
    try {
      const health = await request('/api/health');
      if (health.service !== 'blueplate-local-flask') throw new Error('Live API unavailable');
    } catch (err) {
      if (liveRequired) app.showError(err.message);
      return;
    }
    try {
      const session = await request('/api/session');
      // Guest form tokens authorize a submission only in this browser session.
      guestEnabled = session.guest_reports_enabled === true;
      demoEnabled = !liveRequired && session.synthetic_demo_enabled === true;
      if (demoEnabled && !window.BluePlateSynthetic) throw new Error("Synthetic module missing");
      app.activateLive({guestEnabled, demoEnabled});
      if (page === 'public' && guestEnabled && session.guest_challenge) configureChallenge(session.guest_challenge);
      if (page === 'admin') {
        await refreshDashboard(true).catch(() => {});
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
