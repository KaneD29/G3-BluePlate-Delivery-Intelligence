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
      streetAddress: (row.verification_provenance ? address : hasAddress ? address : ''),
      branchLabel: String(row.branch_label || ''),
      cuisine: String(row.cuisine_classification?.label || row.cuisine_name || (row.verification_provenance ? 'Not specified' : 'Unclassified')),
      cuisineClassification:row.cuisine_classification||null,
      verificationProvenance: row.verification_provenance || null,
      operatingStatus: row.operational_status || null,
      confirmedOn: row.confirmed_on || null,
      osmHours: row.osm_opening_hours || null,
      guestReportingEligible: row.guest_reporting_eligible === undefined || Boolean(row.guest_reporting_eligible),
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
  let expandedDirectoryEnabled = false;
  let warehouseFreshnessEnabled = false;
  let studentDashboardEnabled = false;
  let displayedSelection;
  async function refreshCurrentModel(id, student=null) {
    const date=student?student.snapshot.report_date:app.scenarioDate?.();
    const data = await request('/api/dashboard/model/current'+(date?'?date='+encodeURIComponent(date):''));
    if (id !== revision) return;
    const snapshot = data.snapshot;
    if (!Array.isArray(snapshot?.restaurants) || !Array.isArray(data.reports_by_venue)) {
      throw new Error('Invalid published model');
    }
    const reported = new Map((student?.reports_by_venue||data.reports_by_venue).map(row => [Number(row.restaurant_key), row]));
    const restaurants = snapshot.restaurants.map(row => ({
      ...restaurant({
        ...reported.get(row.restaurant_key),
        restaurant_key: row.restaurant_key, external_place_id: row.external_place_id,
        restaurant_name: row.name, street_address: row.address, zone_name: 'Zone '+row.distance_zone+' — '+row.distance_zone_name,
        distance_to_ust_km: row.distance_m/1000, cuisine_name: row.cuisine_classification?.label || row.cuisine_osm || 'Not specified',
        cuisine_classification:row.cuisine_classification,
        verification_provenance: row.operating_provenance, operational_status: row.operating_status,
        proxy_delivery_mins: row.modeled_eta_high_min,
      }),
      etaLow:row.modeled_eta_low_min, etaHigh:row.modeled_eta_high_min,
      transitStress:row.eta_stress_index_points, areas:row.address_clusters,
      demand:{low:row.hypothetical_demand_low,base:row.hypothetical_demand_base,high:row.hypothetical_demand_high},
      genuineTotals:reported.get(row.restaurant_key)||{},
    })).sort((a,b)=>a.distance-b.distance||a.name.localeCompare(b.name)||a.id-b.id);
    app.setAdmin({restaurants, alerts:[], trend:[], hasObservations:true,
      reportTotals:student?.report_totals||data.report_totals, directoryCoverage:data.coverage, model:snapshot, student});
  }

  async function refreshStudentDashboard(id, range) {
    const selection=await request('/api/dashboard/student-period?'+(app.isLatestAvailable()?'latest=1':qrange(range)));
    if(id!==revision)return;
    const snapshot=selection.snapshot;
    displayedSelection=snapshot;
    if(snapshot?.metric_family==='DELIVERY_SCENARIO')return refreshCurrentModel(id,selection);
    const reports=new Map(selection.reports_by_venue.map(row=>[Number(row.restaurant_key),row]));
    const genuine=row=>{
      const data=reports.get(Number(row.id))||{};
      return {...row,genuineTotals:data,reportCount:data.auditor_report_count||0,
        selfReportedRating:numberOrNull(data.auditor_avg_rating),verified:numberOrNull(data.observed_delivery_mins)};
    };
    let venues,alerts=[];
    if(snapshot){
      const date=snapshot.report_date, query=qrange({from:date,to:date});
      const [overview, notices]=await Promise.all([request('/api/dashboard/overview?'+query),request('/api/dashboard/alerts?'+query)]);
      venues=uniqueRestaurants(overview.restaurants.map(restaurant)).map(genuine);
      alerts=notices.alerts.map(a=>({id:a.alert_id,restaurant:a.restaurant_name,zone:a.zone_name,severity:a.severity_level,
        message:a.alert_message,timestamp:dateOnly(a.created_at),status:a.workflow_status}));
    }else{
      venues=(await fetchDirectory()).map(genuine);
    }
    if(id!==revision)return;
    app.setAdmin({restaurants:venues,alerts,trend:[],reportTotals:selection.report_totals,student:selection,
      hasObservations:Boolean(snapshot)||selection.report_totals.auditor_report_count>0});
  }

  async function refreshAdmin(range) {
    const id = ++revision;
    const query = qrange(range);
    try {
      if (warehouseFreshnessEnabled) {
        request('/api/dashboard/freshness').then(data=>{
          if (id===revision) app.setWarehouseFreshness(data);
        }).catch(()=>{if (id===revision) app.setWarehouseFreshness(null);});
      }
      if (studentDashboardEnabled) return await refreshStudentDashboard(id,range);
      if (app.wantsCurrentModel?.()) return await refreshCurrentModel(id);
      const [ov, alerts, trends, coverage] = await Promise.all([
        request(`/api/dashboard/overview?${query}`),
        demoEnabled ? Promise.resolve({alerts: []}) : request(`/api/dashboard/alerts?${query}`),
        demoEnabled ? Promise.resolve({days: []}) : request(`/api/dashboard/trends?${query}`),
        expandedDirectoryEnabled ? request(`/api/dashboard/directory-coverage?${query}`) : null
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
        directoryCoverage: coverage,
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
    if (studentDashboardEnabled||app.wantsCurrentModel?.()) return refreshAdmin(app.getRange());
    if (!demoEnabled) {
      const pending = ++coverageRevision;
      const initialRevision = revision;
      app.setGuestReportDate(undefined);
      // The coverage endpoint counts every report source. The existing public
      // feed supplies a guest-only date without changing the dashboard filter.
      const limit = 50;
      request(`/api/user/reviews?limit=${limit}`).then(data => {
        if (pending !== coverageRevision || data.status !== 'ok' || !Array.isArray(data.reviews)) return;
        const guest = data.reviews.find(row => row?.submission_source === 'GUEST');
        const date = dateOnly(guest?.submitted_at);
        if (/^\d{4}-\d\d-\d\d$/.test(date)) app.setGuestReportDate(date);
        else if (!guest && data.reviews.length < limit) app.setGuestReportDate(null);
      }).catch(() => {});
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
  async function fetchDirectory() {
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
    return all.some(row => row.verification_provenance) ? all.map(restaurant) : uniqueRestaurants(all.map(restaurant));
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
        challengeWidget = window.turnstile.render(panel, {
          sitekey: site_key, action, size: panel.clientWidth < 300 ? 'compact' : 'normal'
        });
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
    if(studentDashboardEnabled){
      if(!displayedSelection){app.notice('No estimates to export for these dates.');return;}
      const date=displayedSelection.report_date;
      window.location.assign(displayedSelection.metric_family==='DELIVERY_SCENARIO'
        ?'/api/exports/model/current.csv?date='+encodeURIComponent(date)
        :'/api/exports/restaurants.csv?'+qrange({from:date,to:date}));
      return;
    }
    const date=app.scenarioDate?.();
    window.location.assign(app.wantsCurrentModel?.() ? '/api/exports/model/current.csv'+(date?'?date='+encodeURIComponent(date):'') : `/api/exports/restaurants.csv?${qrange(range)}`);
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
      expandedDirectoryEnabled = session.expanded_directory === true;
      warehouseFreshnessEnabled = session.versioned_bi === true;
      studentDashboardEnabled = warehouseFreshnessEnabled && Boolean(session.current_bi_model);
      demoEnabled = !liveRequired && session.synthetic_demo_enabled === true;
      if (demoEnabled && !window.BluePlateSynthetic) throw new Error("Synthetic module missing");
      app.activateLive({guestEnabled, demoEnabled});
      if (page === 'public' && guestEnabled && session.guest_challenge) configureChallenge(session.guest_challenge);
      if (page === 'admin') {
        if(studentDashboardEnabled&&app.configureCurrentModel){
          const params=new URLSearchParams(location.search);
          if(params.get('model')==='legacy'&&!params.has('from')&&!params.has('to')){
            const dates=await request('/api/dashboard/freshness').catch(()=>null);
            if(dates){
              app.setWarehouseFreshness(dates);
              const earlier=dates.analytical_dates.find(row=>row.metric_family==='LEGACY_DAILY');
              if(earlier){params.set('from',earlier.report_date);params.set('to',earlier.report_date);}
            }
          }
          app.configureCurrentModel(true,params,true);
        }else{
          app.configureCurrentModel?.(Boolean(session.current_bi_model),new URLSearchParams(location.search));
        }
        await refreshDashboard(true).catch(() => {});
      } else if (page === 'public') {
        demoRestaurants = await fetchDirectory();
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
