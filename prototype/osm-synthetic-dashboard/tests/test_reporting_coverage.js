// Runs the real reporting controls and bridge with a minimal DOM and mocked Flask.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const assets = path.join(__dirname, '../frontend/assets');
const bridge = fs.readFileSync(path.join(assets, 'api-bridge.js'), 'utf8');
const source = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const latest = '2020-11-15';
const range = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function start({demo = false, staticSite = false, failCoverage = false, failGuestFeed = false, liveRequired = false, failHealth = false, failSession = false, failOverview = false, now = "2026-11-23T12:00:00Z"} = {}) {
  const calls = [];
  const updates = [];
  const errors = [];
  const buttons = ['latest', 'latest-report', '7d', '30d', '90d', 'custom'].map(period => ({
    dataset: {period}, classList: {toggle() {}},
    setAttribute(key, value) { this[key] = value; }
  }));
  const elements = {
    overview: {querySelector: () => ({insertAdjacentElement() {}})},
    'bp-period-caption': {},
    'bp-view-freshness': {},
    'bp-warehouse-date': {},
    'bp-latest-guest-date': {},
    'bp-dashboard-loaded-at': {},
    'bp-directory-date': {},
    'simulate-refresh': {},
    'bp-latest-period': buttons[0],
    'bp-latest-report-period': buttons[1],
    'bp-custom-dates': {classList: {toggle() {}}},
    'bp-custom-from': {},
    'bp-custom-to': {},
    'bp-custom-apply': {}
  };
  const document = {
    readyState: 'complete', body: {dataset: {page: 'admin', liveRequired: String(liveRequired)}},
    getElementById: id => elements[id],
    querySelectorAll: () => buttons, createElement: () => ({querySelectorAll: () => buttons})
  };
  let resolveCoverage;
  const coverage = new Promise(resolve => { resolveCoverage = resolve; });
  let refreshedCoverage;
  let reportTotals = {auditor_report_count: 0};
  let restaurants = [{restaurant_key: 1, restaurant_name: 'Directory listing'}];
  let days = [];
  let guestFeed = [];
  const window = {BluePlateSynthetic: {metrics: row => row, alerts: () => [], trend: () => []}};
  const context = vm.createContext({
    window, document, liveRequired, $: id => elements[id],
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
    },
    console: {warn() {}, error() {}}, renderAdmin() {}, toast: message => assert.fail(message),
    async fetch(url) {
      calls.push(url);
      let data;
      if (url === '/api/health') {
        if (failHealth) throw new Error('Health unavailable');
        data = {service: staticSite ? 'static-site' : 'blueplate-local-flask'};
      }
      if (url === '/api/session') {
        if (failSession) throw new Error('Session unavailable');
        data = {synthetic_demo_enabled: demo};
      }
      if (url === '/api/dashboard/coverage') {
        if (failCoverage) throw new Error('Coverage unavailable');
        data = {status: 'ok', ...(refreshedCoverage ?? await coverage)};
      }
      if (url === '/api/user/reviews?limit=50') {
        if (failGuestFeed) throw new Error('Guest feed unavailable');
        data = {status: 'ok', reviews: guestFeed};
      }
      if (url.startsWith('/api/dashboard/overview?')) {
        if (failOverview) throw new Error('Database unavailable');
        data = {restaurants, report_totals: reportTotals};
      }
      if (url.startsWith('/api/dashboard/alerts?')) data = {alerts: []};
      if (url.startsWith('/api/dashboard/trends?')) data = {days};
      assert.ok(data, url);
      return {ok: true, json: async () => data};
    },
    updates, errors
  });
  const fields = source.slice(source.indexOf("let periodPreset="), source.indexOf('const liveNumber='));
  const periods = source.slice(source.indexOf('function localDay('), source.indexOf('// ----- Restaurant detail view'));
  const coverageMethod = source.slice(source.indexOf(' setGuestReportDate('), source.indexOf(' setPublic(restaurants)'));
  vm.runInContext(fields + periods + `
    window.BluePlateApp = {
      ${coverageMethod}
      getRange: currentRange,
      activateLive({demoEnabled}) { liveMode = true; syntheticDemo = demoEnabled; },
      setAdmin(data) { updates.push(data); liveHasObservations = data.hasObservations; dashboardLoadedAt = new Date(); renderPeriodCaption(); },
      showError(message) { errors.push(message); }
    };
    initPeriodToolbar();
  `, context);
  const app = window.BluePlateApp;
  const initialRange = range(app.getRange());
  vm.runInContext(bridge, context);
  return {
    calls, updates, errors, elements, initialRange,
    resolveCoverage: (day, reportDay = null) => resolveCoverage({
      latest_reporting_date: day, latest_report_submission_date: reportDay
    }),
    refresh: (day, reportDay) => {
      refreshedCoverage = {latest_reporting_date: day, latest_report_submission_date: reportDay};
      return window.BluePlateBridge.refreshDashboard();
    },
    range: () => range(app.getRange()),
    active: () => buttons.find(button => button['aria-pressed'] === 'true').dataset.period,
    click: period => buttons.find(button => button.dataset.period === period).onclick(),
    caption: () => elements['bp-period-caption'].textContent,
    freshness: () => ['bp-warehouse-date','bp-latest-guest-date','bp-dashboard-loaded-at'].map(id=>elements[id].textContent),
    setGuestFeed: rows => { guestFeed = rows; },
    setReports: count => {
      reportTotals = {auditor_report_count: count * 2};
      const venue = {...restaurants[0], street_address: 'UST', auditor_report_count: count,
        proxy_delivery_mins: 20, observed_delivery_mins: 28};
      restaurants = [venue, {...venue, restaurant_key: 2}];
    },
    setDays: value => { days = value; },
    overviewCalls: () => calls.filter(url => url.startsWith('/api/dashboard/overview?'))
  };
}

function testUnavailableRendering() {
  const start = source.indexOf('function renderAdmin(){');
  const end = source.indexOf('function renderDirectoryCoverage(', start);
  const elements = Object.fromEntries([
    'executive-summary', 'kpis', 'alerts-list', 'directory-rows',
    'restaurant-count', 'filter-summary', 'bp-directory-coverage'
  ].map(id => [id, {textContent: 'Stale', replaceChildren() { this.textContent = ''; }}]));
  let destroyed = false;
  const context = {
    liveRequired: true, liveError: 'Live warehouse data is temporarily unavailable.',
    charts: [{destroy() { destroyed = true; }}], $: id => elements[id],
    renderKpis() { assert.fail('Unavailable dashboard must not render metrics'); },
  };
  vm.runInNewContext(source.slice(start, end) + 'renderAdmin();', context);
  assert.equal(destroyed, true);
  assert.equal(elements.kpis.textContent, '');
  assert.equal(elements['directory-rows'].textContent, '');
  assert.match(elements['executive-summary'].textContent, /warehouse data is temporarily unavailable/);
}

async function test() {
  testUnavailableRendering();
  const dashboard = start();
  await tick();
  assert.equal(dashboard.overviewCalls().length, 0);
  dashboard.setDays([{report_date: latest, modeled_demand: 0}]);
  dashboard.resolveCoverage(latest);
  await tick();
  assert.deepEqual(dashboard.overviewCalls(), [`/api/dashboard/overview?from=${latest}&to=${latest}`]);
  assert.equal(dashboard.active(), 'latest');
  assert.equal(dashboard.freshness()[0], '2020-11-15');
  assert.equal(dashboard.freshness()[1], 'No guest reports yet');
  assert.notEqual(dashboard.freshness()[2], 'Not available');
  assert.match(dashboard.caption(), /^Modeled warehouse snapshot · 2020-11-15/);
  assert.equal(dashboard.updates[0].hasObservations, true);

  dashboard.setDays([]);
  dashboard.click('30d');
  await tick();
  assert.equal(dashboard.range().to, dashboard.initialRange.to);
  assert.equal(dashboard.updates.at(-1).restaurants.length, 1);
  assert.match(dashboard.caption(), /No warehouse estimates or student reports for this period/);
  dashboard.setReports(1);
  const countBeforeDraft = dashboard.overviewCalls().length;
  dashboard.click('custom');
  assert.equal(dashboard.overviewCalls().length, countBeforeDraft);
  assert.match(dashboard.caption(), /Apply dates/);
  dashboard.elements['bp-custom-from'].value = dashboard.initialRange.from;
  dashboard.elements['bp-custom-to'].value = dashboard.initialRange.from;
  dashboard.elements['bp-custom-apply'].onclick();
  await tick();
  assert.deepEqual(dashboard.range(), {from: dashboard.initialRange.from, to: dashboard.initialRange.from});
  assert.equal(dashboard.updates.at(-1).hasObservations, true);
  assert.doesNotMatch(dashboard.caption(), /No warehouse estimates or student reports/);
  const reportUpdate = dashboard.updates.at(-1);
  assert.equal(reportUpdate.restaurants.length, 1, 'Directory deduplication still applies');
  assert.equal(reportUpdate.reportTotals.auditor_report_count, 2, 'All submitted reports count even across duplicate listings');
  assert.equal(reportUpdate.restaurants[0].proxyDeliveryMins, 20);
  assert.equal(reportUpdate.restaurants[0].verified, 28);

  const independentDates = start();
  independentDates.resolveCoverage('2026-11-15', '2026-11-22');
  await tick();
  assert.equal(independentDates.active(), 'latest');
  assert.deepEqual(independentDates.range(), {from: '2026-11-15', to: '2026-11-15'});
  independentDates.setGuestFeed([{submission_source:'AUTHENTICATED',submitted_at:'2026-11-23T08:00:00+08:00'},
    {submission_source:'GUEST',submitted_at:'2026-11-22T00:10:00+08:00'}]);
  independentDates.click('latest-report');
  await tick();
  assert.deepEqual(independentDates.range(), {from: '2026-11-22', to: '2026-11-22'});
  await independentDates.refresh('2026-11-16', '2026-11-23');
  assert.equal(independentDates.active(), 'latest-report');
  assert.deepEqual(independentDates.range(), {from: '2026-11-23', to: '2026-11-23'});
  assert.equal(independentDates.freshness()[0], '2026-11-16');
  assert.equal(independentDates.freshness()[1], '2026-11-22');
  assert.match(independentDates.caption(), /^Student-reported feedback · 2026-11-23/);
  assert.equal(independentDates.calls.filter(url => url === '/api/dashboard/coverage').length, 2);
  independentDates.click('latest');
  await tick();
  assert.deepEqual(independentDates.range(), {from: '2026-11-16', to: '2026-11-16'});
  await independentDates.refresh(null, '2026-11-23');
  assert.equal(independentDates.active(), 'custom');
  assert.deepEqual(independentDates.range(), {from: '2026-11-16', to: '2026-11-16'},
    'A missing latest date must not silently switch report sources');

  const manilaMidnight = start({now: '2026-11-23T16:00:00Z'});
  manilaMidnight.resolveCoverage(null);
  await tick();
  assert.equal(manilaMidnight.range().to, '2026-11-24');

  const race = start();
  await tick();
  race.click('90d');
  race.resolveCoverage(latest);
  await tick();
  assert.equal(race.overviewCalls().length, 1);
  assert.equal(race.active(), '90d');
  assert.equal(race.range().to, race.initialRange.to);
  assert.equal(race.freshness()[0], '2020-11-15');

  const earlyChoice = start();
  earlyChoice.click('30d');
  await tick();
  earlyChoice.resolveCoverage(latest);
  await tick();
  assert.equal(earlyChoice.active(), '30d');
  assert.equal(earlyChoice.overviewCalls().length, 1);

  const noHistory = start();
  noHistory.resolveCoverage(null);
  await tick();
  assert.deepEqual(noHistory.range(), noHistory.initialRange);
  assert.equal(noHistory.freshness()[0], 'Not available');
  assert.equal(noHistory.updates[0].hasObservations, false);

  const unavailable = start({failCoverage: true});
  await tick();
  assert.deepEqual(unavailable.range(), unavailable.initialRange);
  assert.equal(unavailable.freshness()[0], 'Not available');
  assert.deepEqual(unavailable.errors, []);
  const failedFeed = start({failGuestFeed:true});
  failedFeed.resolveCoverage(latest);
  await tick();
  assert.equal(failedFeed.freshness()[1], 'Not available');
  assert.equal(failedFeed.updates.length, 1, 'Guest feed failure must not block the dashboard');
  const cappedFeed = start();
  cappedFeed.setGuestFeed(Array.from({length:50},()=>({submission_source:'AUTHENTICATED',submitted_at:'2026-11-23T08:00:00+08:00'})));
  cappedFeed.resolveCoverage(latest,'2026-11-23');
  await tick();
  assert.equal(cappedFeed.freshness()[1], 'Not available', 'A capped feed cannot prove zero guest reports');

  const outageCases = [
    [{failHealth: true}, 'Health unavailable'],
    [{staticSite: true}, 'Live API unavailable'],
    [{failSession: true}, 'Session unavailable'],
    [{failOverview: true}, 'Database unavailable'],
  ];
  for (const [options, expected] of outageCases) {
    const live = start({liveRequired: true, ...options});
    live.resolveCoverage(latest);
    await tick();
    assert.deepEqual(live.errors, [expected]);
    assert.equal(live.updates.length, 0, 'An outage must not render a demo dataset');
    assert.doesNotMatch(live.caption(), /Data simulated/);
  }

  const liveOnly = start({liveRequired: true, demo: true});
  liveOnly.resolveCoverage(latest);
  await tick();
  assert.equal(liveOnly.updates[0].demo, false, 'Live-only HTML must ignore synthetic capabilities');
  assert.equal(liveOnly.active(), 'latest');

  const demo = start({demo: true});
  const staticSite = start({staticSite: true});
  await tick();
  assert.deepEqual(demo.range(), demo.initialRange);
  assert.equal(demo.overviewCalls().length, 1);
  assert.ok(!demo.calls.includes('/api/dashboard/coverage'));
  assert.match(demo.caption(), /SYNTHETIC DEMONSTRATION/);
  assert.deepEqual(staticSite.calls, ['/api/health']);
  assert.match(staticSite.caption(), /Data simulated/);
}
test().then(() => console.log('Reporting coverage tests passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
