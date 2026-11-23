const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const assets = path.join(__dirname, '../frontend/assets');
const bridge = fs.readFileSync(path.join(assets, 'api-bridge.js'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const submitCode = app.slice(app.indexOf('function guestPayload('), app.indexOf('function initAdmin('));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function test({production = false} = {}) {
  let now = 1000;
  let ids = 0;
  let formTokens = 0;
  let challengeToken = '';
  let outcome = 'no';
  let resets = 0;
  const messages = [];
  const requests = [];
  const confirmations = [];
  const outcomes = [429, 503, 200, 409, 201];
  let reads = 0;
  const button = {disabled: false, before() {}};
  const details = {value: 'Original private note'};
  const feed = {};
  const elements = {
    'audit-restaurant': {value: '1'},
    'audit-minutes': {value: '23', focus() {}},
    stars: {querySelector: () => ({focus() {}})},
    'audit-details': details,
    'audit-form': {querySelector: () => button, reset() {}},
    'recent-reviews': feed,
  };
  const document = {
    readyState: 'complete',
    body: {dataset: {page: 'public', liveRequired: String(production)}},
    getElementById: id => elements[id],
    createElement: () => ({clientWidth: 260}),
    head: {append(script) {
      assert.equal(script.src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
      script.onload();
    }},
    querySelector: () => outcome ? {value: outcome} : null,
    querySelectorAll: () => [],
  };
  const window = {
    turnstile: {
      render(panel, config) {
        assert.equal(config.sitekey, 'mock-site-key');
        assert.equal(config.action, 'blueplate_guest_report');
        assert.equal(config.size, 'compact');
        return 'widget';
      },
      getResponse(widget) { assert.equal(widget, 'widget'); return challengeToken; },
      reset(widget) { assert.equal(widget, 'widget'); challengeToken = ''; resets++; },
    },
    BluePlateApp: {
      activateLive({guestEnabled}) { assert.equal(guestEnabled, true); },
      setPublic() {},
      setPublicReviews(reports) { context.liveReports = reports; },
      showError(message) { assert.fail(message); },
    },
  };
  const context = vm.createContext({
    window, document, Date: class extends Date { static now() { return now; } },
    liveMode: true, liveGuestEnabled: true, syntheticDemo: false,
    pendingGuestReport: undefined, guestRetryAt: 0, selectedNotes: new Set(), selectedRating: 5,
    crypto: {randomUUID: () => `uuid-${++ids}`},
    state: {restaurants: [{id: 1, name: 'Example'}]},
    $: id => elements[id], toast: message => messages.push(message),
    setRating() {}, updateCancelled() {}, showSubmissionConfirmation: report => confirmations.push(report),
    html: value => String(value ?? ''), formatDateTime: () => 'Nov 15',
    liveNumber: Number, numberText: (value, digits) => value.toFixed(digits),
    console,
    async fetch(url, options) {
      let data, status = 200, retryAfter;
      if (url === '/api/health') data = {service: 'blueplate-local-flask'};
      else if (url === '/api/session') {
        data = {guest_reports_enabled: true, guest_form_token: `token-${++formTokens}`};
        if (production) data.guest_challenge = {site_key: 'mock-site-key', action: 'blueplate_guest_report'};
      } else if (url.startsWith('/api/restaurants?')) {
        data = {restaurants: [{restaurant_key: 1, restaurant_name: 'Example'}], next_offset: null};
      } else if (url === '/api/user/reviews?limit=12') {
        reads++;
        data = {reviews: [{restaurant_name: 'Example', rating_score: 5, actual_observed_delivery_mins: 23,
          comment_text: 'Private response text'}]};
      } else if (url === '/api/user/reviews') {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.equal(options.headers['X-BluePlate-Form-Token'], `token-${formTokens}`);
        const payload = JSON.parse(options.body);
        if (production) assert.equal(payload.challenge_response, `challenge-${requests.length + 1}`);
        else assert.equal(payload.challenge_response, undefined);
        requests.push(payload);
        status = outcomes.shift();
        if (status === 429) retryAfter = '12';
        data = status === 200 ? {status: 'replayed', user_review_id: 1} :
          status === 201 ? {status: 'created', user_review_id: 2} : {message: `Error ${status}`};
      } else assert.fail(url);
      return {ok: status < 400, status, headers: {get: () => retryAfter}, json: async () => data};
    },
  });
  vm.runInContext(submitCode + bridge, context);
  await flush();

  function submit(solve = true) {
    if (production && solve) challengeToken = `challenge-${requests.length + 1}`;
    vm.runInContext('submitPublic({preventDefault(){}})', context);
    return flush();
  }

  outcome = null;
  await submit();
  assert.match(messages.at(-1), /Choose Delivered or Cancelled/);
  outcome = 'no';
  elements['audit-minutes'].value = '';
  await submit();
  assert.match(messages.at(-1), /between 1 and 240/);
  elements['audit-minutes'].value = '23';
  context.selectedRating = 0;
  await submit();
  assert.match(messages.at(-1), /Choose a rating/);
  context.selectedRating = 5;
  details.value = '';
  await submit();
  assert.match(messages.at(-1), /Select at least one quick note/);
  details.value = 'Original private note';
  assert.equal(requests.length, 0, 'Incomplete choices must not send a report');

  if (production) {
    challengeToken = '';
    await submit(false);
    assert.match(messages.at(-1), /Complete the report verification challenge/);
    assert.equal(requests.length, 0);
  }
  await submit();
  assert.match(messages.at(-1), /12 seconds/);
  await submit();
  assert.equal(requests.length, 1);
  now += 12000;
  await submit();
  assert.match(messages.at(-1), /503/);
  await submit();
  assert.equal(confirmations.length, 1);
  assert.equal(reads, 2, 'A replay refreshes the public feed');
  assert.deepEqual(requests.map(row => row.client_submission_id), ['uuid-1', 'uuid-1', 'uuid-1']);

  await submit();
  assert.match(messages.at(-1), /409/);
  details.value = 'Edited private note';
  outcome = 'yes';
  await submit();
  assert.equal(requests.at(-1).order_was_cancelled, true);
  assert.equal(requests.at(-1).actual_observed_delivery_mins, null);
  assert.equal(confirmations.length, 2);
  assert.deepEqual(requests.map(row => row.client_submission_id),
    ['uuid-1', 'uuid-1', 'uuid-1', 'uuid-2', 'uuid-3']);
  assert.equal(button.disabled, false);
  assert.equal(resets, production ? 5 : 0);

  vm.runInContext('renderPublicReviews()', context);
  assert.match(feed.innerHTML, /23 min delivery.*Self-reported/);
  assert.doesNotMatch(feed.innerHTML, /Private response text/);
  vm.runInContext('syntheticDemo = true; renderPublicReviews()', context);
  assert.match(feed.innerHTML, /Private response text/, 'Synthetic sample notes remain visible');
}

test().then(() => test({production: true})).then(() => console.log('Guest-report browser tests passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
