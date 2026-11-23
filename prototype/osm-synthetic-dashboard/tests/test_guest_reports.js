const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const assets = path.join(__dirname, '../frontend/assets');
const bridge = fs.readFileSync(path.join(assets, 'api-bridge.js'), 'utf8');
const app = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const submitCode = app.slice(app.indexOf('function guestPayload('), app.indexOf('function initAdmin('));
const confirmationCode = app.slice(app.indexOf('function showSubmissionConfirmation('), app.indexOf('// Explicit bridge interface'));
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
  const outcomes = [429, 503, 'network', 'malformed', 200, 409, 201];
  let reads = 0;
  let formResets = 0;
  let releaseFirstPost;
  const button = {disabled: false, before() {}};
  const details = {value: 'Original private note', focus() {}};
  const feed = {};
  const elements = {
    'audit-restaurant': {value: '1'},
    'audit-minutes': {value: '23', focus() {}},
    stars: {querySelector: () => ({focus() {}})},
    'audit-details': details,
    'audit-form': {querySelector: () => button, reset() { formResets++; }},
    'bp-report-fields': {setAttribute(key, value) { this[key] = value; }},
    'bp-report-progress': {},
    'bp-report-error': {set textContent(value) { if (value) messages.push(value); }, focus() { this.focused = true; }},
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
    querySelector: selector => selector.endsWith(':checked') ? outcome ? {value: outcome} : null : {focus() {}},
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
    pendingGuestReport: undefined, guestSubmissionPending: false, guestRetryAt: 0, selectedNotes: new Set(), selectedRating: 5,
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
        if (requests.length === 1) await new Promise(resolve => { releaseFirstPost = resolve; });
        if (status === 'network') throw new TypeError('Sensitive network details');
        if (status === 'malformed') return {ok: true, json: async () => ({status: 'error', user_review_id: 900})};
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
  details.value = 'x'.repeat(1000);
  context.selectedNotes.add('Fast delivery');
  await submit();
  assert.match(messages.at(-1), /1,000 characters total/);
  assert.equal(requests.length, 0);
  details.value = 'Original private note';

  if (production) {
    challengeToken = '';
    await submit(false);
    assert.match(messages.at(-1), /Complete the report verification challenge/);
    assert.equal(requests.length, 0);
  }
  await submit();
  assert.equal(button.disabled, true);
  assert.equal(elements['bp-report-fields'].disabled, true);
  assert.equal(elements['bp-report-fields']['aria-busy'], 'true');
  assert.equal(elements['bp-report-progress'].textContent, 'Sending your report.');
  vm.runInContext('submitPublic({preventDefault(){}})', context);
  assert.equal(requests.length, 1, 'A repeat while pending must not make a second POST');
  releaseFirstPost();
  await flush();
  assert.match(messages.at(-1), /12 seconds/);
  await submit();
  assert.equal(requests.length, 1);
  now += 12000;
  await submit();
  assert.match(messages.at(-1), /couldn’t confirm/);
  await submit();
  assert.match(messages.at(-1), /Retry with the same entries/);
  assert.doesNotMatch(messages.at(-1), /Sensitive network details/);
  await submit();
  assert.equal(formResets, 0, 'Malformed successful HTTP response must not clear the form');
  assert.equal(confirmations.length, 0);
  assert.equal(details.value, 'Original private note');
  assert.deepEqual([...context.selectedNotes], ['Fast delivery']);
  assert.equal(elements['bp-report-error'].focused, true);
  assert.match(messages.at(-1), /couldn’t confirm/);
  await submit();
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].status, 'replayed');
  assert.equal(confirmations[0].user_review_id, 1);
  assert.equal(reads, 2, 'A replay refreshes the public feed');
  assert.deepEqual(requests.map(row => row.client_submission_id), Array(5).fill('uuid-1'));

  assert.ok(requests.every(row => row.comment_text === 'Fast delivery · Original private note'));

  await submit();
  assert.match(messages.at(-1), /conflicts with an earlier submission/);
  details.value = 'Edited private note';
  outcome = 'yes';
  context.selectedNotes.add('No rider available');
  await submit();
  assert.equal(requests.at(-1).rating_score, 5);
  assert.equal(requests.at(-1).comment_text, 'No rider available · Edited private note');
  assert.equal(requests.at(-1).order_was_cancelled, true);
  assert.equal(requests.at(-1).actual_observed_delivery_mins, null);
  assert.equal(confirmations.length, 2);
  assert.equal(confirmations[1].user_review_id, 2);
  assert.deepEqual(requests.map(row => row.client_submission_id),
    [...Array(5).fill('uuid-1'), 'uuid-2', 'uuid-3']);
  assert.equal(formResets, 2);
  assert.equal(button.disabled, false);
  assert.equal(elements['bp-report-fields'].disabled, false);
  assert.equal(elements['bp-report-progress'].textContent, '');
  assert.equal(resets, production ? 7 : 0);

  vm.runInContext('renderPublicReviews()', context);
  assert.match(feed.innerHTML, /23 min delivery.*Self-reported/);
  assert.doesNotMatch(feed.innerHTML, /Private response text/);
  vm.runInContext('syntheticDemo = true; renderPublicReviews()', context);
  assert.match(feed.innerHTML, /Private response text/, 'Synthetic sample notes remain visible');
}

function testReceiptMarkup() {
  const elements = {
    'bp-report-success': {classList: {add() {}, remove() {}}},
    'audit-form': {classList: {add() {}}},
    'bp-submit-another': {},
    'bp-success-heading': {focus() { this.focused = true; }},
    'report-form-section': {scrollIntoView() {}},
  };
  vm.runInNewContext(confirmationCode + `
    showSubmissionConfirmation({status:'created',user_review_id:71,comment_text:'Private note',client_submission_id:'internal-uuid'});
  `, {$: id => elements[id], liveMode: true, syntheticDemo: false, html: String});
  assert.match(elements['bp-report-success'].innerHTML, /Report saved/);
  assert.match(elements['bp-report-success'].innerHTML, /Report reference <strong>#71/);
  assert.match(elements['bp-report-success'].innerHTML, /href="#recent"/);
  assert.doesNotMatch(elements['bp-report-success'].innerHTML, /Private note|internal-uuid|Browser time/);
  assert.equal(elements['bp-success-heading'].focused, true);
}

testReceiptMarkup();
test().then(() => test({production: true})).then(() => console.log('Guest-report browser tests passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});


require('node:test')('outcome changes clear chips while same-outcome updates preserve selections', () => {
  const notes = {dataset: {}};
  const elements = {
    'quick-notes': notes, 'quick-notes-hint': {}, 'audit-minutes': {},
    'minutes-hint': {}, 'audit-details': {value: 'Still pending'},
  };
  const selectedNotes = new Set();
  let outcome;
  const context = vm.createContext({
    selectedNotes, html: String, $: id => elements[id],
    document: {querySelector: () => outcome && {value: outcome}},
  });
  const render = () => vm.runInContext('updateCancelled()', context);
  vm.runInContext(app.slice(app.indexOf('const quickNotesByOutcome'), app.indexOf('function guestPayload(')), context);
  render();
  assert.equal(notes.innerHTML, '');
  outcome = 'no';
  render();
  assert.match(notes.innerHTML, /Fast delivery/);
  assert.doesNotMatch(notes.innerHTML, /Item unavailable/);
  selectedNotes.add('Fast delivery');
  render();
  assert.equal(selectedNotes.size, 1);
  outcome = 'yes';
  render();
  assert.equal(selectedNotes.size, 0);
  assert.match(notes.innerHTML, /Item unavailable/);
  assert.doesNotMatch(notes.innerHTML, /Fast delivery/);
  assert.equal(elements['audit-minutes'].disabled, true);
  selectedNotes.add('Item unavailable');
  outcome = 'no';
  render();
  assert.equal(selectedNotes.size, 0);
  assert.match(notes.innerHTML, /Fast delivery/);
  assert.equal(elements['audit-minutes'].required, true);
  assert.equal(elements['audit-details'].value, 'Still pending');
});
