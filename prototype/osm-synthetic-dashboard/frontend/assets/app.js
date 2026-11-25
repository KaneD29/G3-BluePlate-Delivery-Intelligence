/* BluePlate v4 - Static demo. No authentication, live API, or shared database connection. */
(() => {
'use strict';
const page = document.body.dataset.page;
const liveRequired = document.body.dataset.liveRequired === 'true';
const state = liveRequired ? {restaurants: [], alerts: []} : bluePlateSampleData;
const $ = id => document.getElementById(id);
const html = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const REPORT_KEY='blueplate_demo_reports_v4';
const NOTE_KEY='blueplate_demo_notes_v4';
const ACTION_NOTE_KEY='blueplate_action_log_v8';
let actionNotes=[];
let actionRestaurantId=null;
let editingActionId=null;
let linkedActionAlert=null;
let pendingActionDelete=null;
const THEME_KEY='blueplate_theme_v4';
let selectedRating=0;
const selectedNotes=new Set();
let charts=[];
let sortBy='default';
const DIRECTORY_PAGE_SIZE=10;
let directoryPage=1;
let activeNav='overview';
let scrollPending=false;
let periodPreset='7d';
let studentMode=false, studentPeriod=null;
let currentModel=null, currentModelAvailable=false, demandScenario='base', warehouseFreshness=null;
let customFrom='';
let customTo='';
let manualPeriodSelected=false;
let customPeriodDraft=false;
let latestReportingDate;
let latestReportSubmissionDate;
let latestGuestReportDate;
let dashboardLoadedAt=null;
let liveHasObservations=null;
let liveReportTotals={};
let modeledHistory=new Map();
// Explicit local-API mode. Static GitHub Pages keeps the original labeled sample demo.
let liveMode=liveRequired;
let syntheticDemo=false; // BluePlateSynthetic_v1: disabled in production and without explicit opt-in
let liveReports=[];
let liveTrend=[];
let liveGuestEnabled=false;
let pendingGuestReport;
let guestSubmissionPending=false;
let guestRetryAt=0;
let liveError=liveRequired?'Connecting…':'';
const liveNumber=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
const numberText=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';


function safeRead(key) {try {return JSON.parse(localStorage.getItem(key))||[];}catch(e){return [];}}
function safeWrite(key,items) {try {localStorage.setItem(key,JSON.stringify(items));return true;} catch(e){return false;}}
function toast(message){const el=document.createElement('div');el.className='toast';const span=document.createElement('span');span.textContent=message;const x=document.createElement('button');x.type='button';x.textContent='×';x.setAttribute('aria-label','Dismiss notification');x.onclick=()=>el.remove();el.append(span,x);$('toasts').append(el);setTimeout(()=>el.remove(),5000);}
function currentThemeChoice(){try{return localStorage.getItem(THEME_KEY)||'system';}catch(e){return 'system';}}
function applyTheme(value,save=true){
 const dark=value==='dark'||(value==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
 document.documentElement.dataset.theme=dark?'dark':'light';
 if(save){try{localStorage.setItem(THEME_KEY,value);}catch(e){}}
 document.querySelectorAll('[data-theme-choice]').forEach(button=>{
  const selected=button.dataset.themeChoice===value;
  button.classList.toggle('active',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
 if(page==='admin')refreshCharts();
}
function initSettings(){
 const toggle=$('settings-button'),popover=$('settings-popover');
 const isOpen=()=>!popover.classList.contains('hidden');
 const setOpen=(open,returnFocus=false)=>{
  popover.classList.toggle('hidden',!open);
  toggle.setAttribute('aria-expanded',String(open));
  if(returnFocus)toggle.focus();
 };
 toggle.onclick=()=>setOpen(!isOpen());
 popover.querySelectorAll('[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>{
  applyTheme(button.dataset.themeChoice);
  setOpen(false,true);
 }));
 popover.addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(!link)return;
  if(link.hash==='#data-methodology'&&link.pathname===location.pathname&&link.origin===location.origin){
   $('data-methodology').open=true;
  }
  setOpen(false);
  if(link.hash==='#report-form-section'&&link.pathname===location.pathname&&link.origin===location.origin){
   requestAnimationFrame(openReportPrivacy);
  }
 });
 document.addEventListener('click',event=>{
  if(isOpen()&&!event.target.closest('.settings-anchor'))setOpen(false);
 });
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  if(isOpen())setOpen(false,true);
  if(page==='admin')closePopups();
 });
 applyTheme(currentThemeChoice(),false);
 const media=window.matchMedia('(prefers-color-scheme: dark)');
 media.addEventListener?.('change',()=>{if(currentThemeChoice()==='system')applyTheme('system',false);});
}
function hydrate(){// Browser-local shared demo state. It is not shared across devices.
 const reports=safeRead(REPORT_KEY);for(const report of reports){const r=state.restaurants.find(x=>x.id===Number(report.restaurantId));if(!r)continue;r.userReviews.unshift({mins:report.minutes===null?null:Number(report.minutes),rating:Number(report.rating),cancelled:!!report.cancelled,note:String(report.notes||''),user:'Campus guest',time:'Recent report',id:report.id});if(report.cancelled)r.cancellationProxyPct=Math.min(100,Number((r.cancellationProxyPct+3.5).toFixed(1)));}
 const notes=safeRead(NOTE_KEY);for(const n of notes){state.managerNotes.unshift({zone:String(n.zone),text:String(n.text),author:'Admin demo',time:'Recently added'});} }
function metrics(r){
 if(liveMode){
  const distance=liveNumber(r.distance);
  return {...r,distance:distance??999,
   eta:liveNumber(r.proxyDeliveryMins),
   ...(syntheticDemo?{blendedRating:liveNumber(r.publicRating)}:{}),
   cancellationProxyPct:liveNumber(r.cancellationProxyPct),
   verified:liveNumber(r.verified),health:r.health||'UNKNOWN',
   orderCount:liveNumber(currentModel?r.demand?.[demandScenario]:r.orderCount),reportCount:Number(r.reportCount||0),hasPeriodData:true};
 }
 const reviews=r.userReviews||[];
 const userRating=reviews.length?reviews.reduce((s,x)=>s+x.rating,0)/reviews.length:r.publicRating;
 const baseRating=Number((r.publicRating*.65+userRating*.35).toFixed(2));
 const observed=reviews.filter(x=>!x.cancelled&&Number.isFinite(x.mins));
 const userTime=observed.length?observed.reduce((s,x)=>s+x.mins,0)/observed.length:r.proxyDeliveryMins;
 const baseEta=Number((r.proxyDeliveryMins*.5+userTime*.5).toFixed(1));
 const distance=parseFloat((r.nearestGate||'').match(/\((\d+(?:\.\d+)?) km\)/)?.[1]||'999');
 const dayRows=page==='admin'?historyFor(r.id):[];
 const guestReports=page==='admin'?visibleGuestReports().filter(x=>Number(x.restaurantId)===r.id):[];
 let eta=baseEta,blendedRating=baseRating,risk=r.cancellationProxyPct,orderCount=null;
 if(dayRows.length){
  const avg=(field)=>dayRows.reduce((a,x)=>a+x[field],0)/dayRows.length;
  eta=avg('eta');risk=avg('risk');blendedRating=avg('rating');
  orderCount=dayRows.reduce((a,x)=>a+x.orders,0);
  const delivered=guestReports.filter(x=>!x.cancelled&&Number.isFinite(Number(x.minutes)));
  if(delivered.length){eta=eta*.8+(delivered.reduce((a,x)=>a+Number(x.minutes),0)/delivered.length)*.2;}
  if(guestReports.length){blendedRating=blendedRating*.8+(guestReports.reduce((a,x)=>a+Number(x.rating),0)/guestReports.length)*.2;}
  // Browser cancellations are real local submissions; mock risk stays explicitly a modeled index.
  eta=Number(eta.toFixed(1));risk=Number(risk.toFixed(1));blendedRating=Number(blendedRating.toFixed(2));
 }
 const health=eta>=42||risk>=15||blendedRating<3.7?'CRITICAL':eta>=34||risk>=8||blendedRating<4.2?'WARNING':'NORMAL';
 return {...r,eta,blendedRating,cancellationProxyPct:risk,health,verified:page==='admin'?(guestReports.filter(x=>!x.cancelled).length?Number((guestReports.filter(x=>!x.cancelled).reduce((a,x)=>a+Number(x.minutes),0)/guestReports.filter(x=>!x.cancelled).length).toFixed(1)):null):(observed.length?Number(userTime.toFixed(1)):null),distance,reportCount:guestReports.length,orderCount,hasPeriodData:page!=='admin'||dayRows.length>0};
}
const enriched=()=>state.restaurants.map(metrics).filter(r=>r.hasPeriodData);
const badge=s=>`<span class="pill ${s.toLowerCase()}"><span class="dot"></span>${s[0]+s.slice(1).toLowerCase()}</span>`;
function reviews(){const out=[];for(const r of state.restaurants){for(const rev of r.userReviews){out.push({r,rev});}}return out;}

function initPublic(){const select=$('audit-restaurant');select.innerHTML='<option value="" disabled selected>Choose a restaurant</option>'+state.restaurants.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(r=>`<option value="${r.id}">${html(r.name)} · ${html(r.branch)}</option>`).join('');
 initRestaurantAutocomplete();
 initSubmissionConfirmation();
 $('quick-notes').addEventListener('click',e=>{const b=e.target.closest('[data-note]');if(!b)return;const val=b.dataset.note;if(selectedNotes.has(val))selectedNotes.delete(val);else selectedNotes.add(val);b.classList.toggle('selected',selectedNotes.has(val));b.setAttribute('aria-pressed',String(selectedNotes.has(val)));});
 $('stars').addEventListener('click',e=>{const b=e.target.closest('[data-star]');if(b)setRating(+b.dataset.star);});setRating(0);
 document.querySelectorAll('input[name="audit-cancelled"]').forEach(x=>x.onchange=updateCancelled);
 updateCancelled();
 $('audit-form').addEventListener('submit',submitPublic);
 renderPublicReviews();
}
// Accessible, custom autocomplete for the public restaurant selector.
// Suggestions use the current restaurant list, replaced by deduplicated MySQL records in live mode.
function publicVenueLabel(venue){
 if(!venue.verificationProvenance)return '';
 if(venue.verificationProvenance==='USER_CONFIRMED')return 'Confirmed by our team';
 if(venue.verificationProvenance==='INDEPENDENTLY_VERIFIED')return 'Open · Independently verified';
 return 'Listed on OpenStreetMap · Opening status not confirmed';
}
function initRestaurantAutocomplete(){
 const select=$('audit-restaurant');
 if(!select || $('restaurant-search'))return;
 const restaurants=()=>state.restaurants.filter(r=>r.guestReportingEligible!==false).sort((a,b)=>a.name.localeCompare(b.name));
 const wrapper=document.createElement('div');
 wrapper.className='bp-restaurant-picker';
 const input=document.createElement('input');
 input.type='text';
 input.id='restaurant-search';
 input.className='form-control bp-restaurant-search';
 input.placeholder='Start typing a restaurant or café…';
 input.autocomplete='off';
 input.spellcheck=false;
 input.setAttribute('role','combobox');
 input.setAttribute('aria-autocomplete','list');
 input.setAttribute('aria-controls','restaurant-suggestions');
 input.setAttribute('aria-expanded','false');
 input.setAttribute('aria-required','true');
 const menu=document.createElement('div');
 menu.id='restaurant-suggestions';
 menu.className='bp-restaurant-suggestions hidden';
 menu.setAttribute('role','listbox');
 menu.setAttribute('aria-label','Restaurant suggestions');
 const hint=document.createElement('p');
 hint.id='bp-restaurant-hint';
 hint.className='bp-restaurant-hint';
 input.setAttribute('aria-describedby',hint.id);
 hint.hidden=true;
 wrapper.append(input,menu,hint);
 select.insertAdjacentElement('afterend',wrapper);
 select.required=false; // The original ID select remains the source of truth for report submission.
 select.classList.add('bp-restaurant-native');
 select.tabIndex=-1;
 select.setAttribute('aria-hidden','true');
 const label=document.querySelector('label[for="audit-restaurant"]');
 if(label)label.htmlFor=input.id;
 const unlistedOption=$('bp-unlisted-option');
 const unlistedFields=$('bp-unlisted-fields');
 const unlistedToggle=$('bp-unlisted-toggle');
 const noMatches=document.createElement('p');
 noMatches.className='bp-restaurant-hint';
 noMatches.setAttribute('role','status');
 noMatches.hidden=true;
 if(unlistedOption)wrapper.append(unlistedOption);
 wrapper.after(noMatches);
 function setUnlisted(open){
  if(!unlistedFields||!unlistedToggle)return;
  unlistedFields.hidden=!open;
  unlistedFields.disabled=!open;
  input.disabled=open;
  input.setAttribute('aria-required',String(!open));
  unlistedToggle.setAttribute('aria-expanded',String(open));
  $('bp-unlisted-label').textContent=open?'Use restaurant search instead':"Can't find your restaurant?";
  if(open){
   select.value='';
   input.value='';
   wrapper.classList.remove('is-selected');
   hint.hidden=true;
   noMatches.hidden=true;
   setOpen(false);
  }
 }
 unlistedToggle?.addEventListener('click',()=>{
  const open=unlistedFields.hidden;
  setUnlisted(open);
  (open?$('bp-unlisted-name'):input).focus();
 });
 let matches=[];
 let active=-1;
 const normalize=str=>String(str||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().trim();
 const setOpen=open=>{
  menu.classList.toggle('hidden',!open);
  input.setAttribute('aria-expanded',String(open));
  if(!open){active=-1;input.removeAttribute('aria-activedescendant');noMatches.hidden=true;}
 };
 function highlight(index){
  active=index;
  menu.querySelectorAll('.bp-restaurant-choice').forEach((el,i)=>{
   const yes=i===active;
   el.classList.toggle('is-active',yes);
   el.setAttribute('aria-selected',String(yes));
   if(yes)el.scrollIntoView({block:'nearest'});
  });
  if(active>=0)input.setAttribute('aria-activedescendant',`restaurant-option-${active}`);
  else input.removeAttribute('aria-activedescendant');
 }
 function selectRestaurant(restaurant){
  select.value=String(restaurant.id);
  input.value=restaurant.name+(restaurant.branch?' · '+restaurant.branch:'');
  wrapper.classList.add('is-selected');
  hint.hidden=false;
  hint.textContent=restaurant.operatingStatus==='UNKNOWN'?'Operating status unknown. Report only an order you actually placed.':'✓ Restaurant selected';
  setOpen(false);
 }
 function render(){
  const term=normalize(input.value);
  const found=restaurants().filter(r=>normalize([r.name,r.branch,r.cuisine,r.zone].join(' ')).includes(term));
  matches=found.slice(0,12);
  active=-1;
  menu.replaceChildren();
  if(!matches.length){
   setOpen(false);
   noMatches.textContent='No matching restaurants.';
   noMatches.hidden=false;
   return;
  }
  noMatches.hidden=true;
  const header=document.createElement('div');
  header.className='bp-restaurant-menu-label';
  header.textContent=term?'Matching restaurants':(liveMode?'Database restaurants':'Sample restaurants');
  menu.append(header);
  matches.forEach((r,i)=>{
   const option=document.createElement('div');
   option.className='bp-restaurant-choice';
   option.id=`restaurant-option-${i}`;
   option.setAttribute('role','option');
   option.setAttribute('aria-selected','false');
   option.tabIndex=-1;
   const name=document.createElement('strong');
   name.textContent=r.name;
   const detail=document.createElement('span');
   detail.textContent=[r.branch,r.cuisine,publicVenueLabel(r),r.zone?.replace('UST - ','')].filter(Boolean).join(' · ');
   option.append(name,detail);
   option.addEventListener('pointerdown',e=>e.preventDefault());
   option.addEventListener('click',()=>selectRestaurant(r));
   menu.append(option);
  });
  if(found.length>matches.length){
   const more=document.createElement('div');
   more.className='bp-restaurant-more';
   more.textContent=`${found.length-matches.length} more — type to narrow results`;
   menu.append(more);
  }
  setOpen(true);
 }
 input.addEventListener('focus',()=>render());
 input.addEventListener('click',()=>{if(menu.classList.contains('hidden'))render();});
 input.addEventListener('input',()=>{
  select.value='';
  wrapper.classList.remove('is-selected');
  hint.hidden=true;
  render();
 });
 input.addEventListener('keydown',e=>{
  if(e.key==='Escape'){setOpen(false);return;}
  if(e.key==='Tab'){setOpen(false);return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();
   if(menu.classList.contains('hidden')){render();highlight(e.key==='ArrowDown'?0:matches.length-1);}
   else if(matches.length)highlight((active+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length);
  }else if(e.key==='Enter'&&!menu.classList.contains('hidden')&&matches.length){
   // Enter selects the highlighted suggestion; a unique match is also selectable.
   if(active>=0||matches.length===1){e.preventDefault();selectRestaurant(matches[active>=0?active:0]);}
  }
 });
 document.addEventListener('pointerdown',e=>{if(!wrapper.contains(e.target))setOpen(false);});
 select._bpFocus=()=>{input.focus();render();};
 select._bpClear=()=>{
  setUnlisted(false);
  select.value='';input.value='';wrapper.classList.remove('is-selected');
  hint.hidden=true;
  setOpen(false);
 };
}

function setRating(n){selectedRating=n;$('rating-value').value=n;document.querySelectorAll('[data-star]').forEach(b=>{b.classList.toggle('filled',Number(b.dataset.star)<=n);b.setAttribute('aria-pressed',String(Number(b.dataset.star)===n));});}
function openReportPrivacy(){
 const privacy=$('bp-report-privacy');
 if(!privacy||privacy.hidden)return;
 const details=$('bp-privacy-details');
 details.open=true;
 const summary=details.querySelector('summary');
 summary.focus({preventScroll:true});
 summary.scrollIntoView({block:'nearest'});
}
const quickNotesByOutcome={
 no:['Fast delivery','Late delivery','Food arrived hot','Food arrived cold','Good packaging','Damaged packaging','Complete order','Missing items','Friendly rider','Other'],
 yes:['Restaurant cancelled','Item unavailable','No rider available','Excessive waiting time','Customer cancelled','Payment issue','Other / Unknown']
};
function updateCancelled(){
 const outcome=document.querySelector('input[name="audit-cancelled"]:checked')?.value;
 const mins=$('audit-minutes');
 mins.required=outcome==='no';mins.disabled=outcome!=='no';
 $('minutes-hint').textContent=outcome==='yes'?'No delivery time is needed for a cancelled order.':
  outcome==='no'?'Enter 1–240 whole minutes from placing the order to delivery.':'Choose an order outcome first.';
 const notes=$('quick-notes');
 const noteOutcome=outcome||'';
 if(notes.dataset.outcome===noteOutcome)return;
 notes.dataset.outcome=noteOutcome;
 selectedNotes.clear();
 $('quick-notes-hint').textContent=outcome
  ?'Choose quick notes or add a written detail.'
  :'Choose an outcome to see quick notes, or add a written detail.';
 notes.innerHTML=(quickNotesByOutcome[noteOutcome]||[]).map(label=>
  `<button type="button" class="tag" data-note="${html(label)}" aria-pressed="false">${html(label)}</button>`
 ).join('');
}
function guestPayload(report, submission) {
 const fingerprint=JSON.stringify(report);
 return submission?.fingerprint===fingerprint
   ? submission
   : {fingerprint, payload:{...report,client_submission_id:crypto.randomUUID()}};
}
function reportError(message, focus){
 const error=$('bp-report-error');
 error.textContent=message;
 if(message)(focus||(()=>error.focus()))();
}
function setGuestSubmissionPending(pending){
 guestSubmissionPending=pending;
 const fields=$('bp-report-fields');
 fields.disabled=pending;
 fields.setAttribute('aria-busy',String(pending));
 const button=$('audit-form').querySelector('[type="submit"]');
 button.disabled=pending||!liveGuestEnabled;
 button.textContent=pending?'Submitting…':liveGuestEnabled?'Submit report':'Reports temporarily disabled';
 $('bp-report-progress').textContent=pending?'Sending your report.':'';
}
function guestSubmissionError(error){
 if(error.status===429){
  const seconds=Math.max(1,error.retryAfter||60);
  guestRetryAt=Date.now()+seconds*1000;
  return `Too many report attempts. Try again in ${seconds} seconds.`;
 }
 if(error.message==='Guest reports are disabled')return 'Guest reports are unavailable right now.';
 if(error.message==='Complete the report verification challenge first.'||error.message==='Complete a new report verification challenge')
  return 'Complete the report verification challenge, then try again.';
 if(error.status===403)return 'Report verification failed. Try submitting again.';
 if(error.status===409)return 'This retry conflicts with an earlier submission. Check Recent campus reports before trying again.';
 if(error.status===400&&error.message==='Unknown or inactive restaurant_key')return 'This restaurant is no longer available for reporting. Choose another listing.';
 if(error.status===400||error.status===413)return 'The report could not be accepted. Review your entries and try again.';
 return 'We couldn’t confirm your submission. Your entries are still here. Retry with the same entries.';
}
async function submitGuestReport(report){
 const remaining=Math.ceil((guestRetryAt-Date.now())/1000);
 if(remaining>0){reportError(`Too many report attempts. Try again in ${remaining} seconds.`);return;}
 if(!liveGuestEnabled){reportError('Guest reports are unavailable right now.');return;}
 setGuestSubmissionPending(true);
 let receipt;
 try{
  pendingGuestReport=guestPayload(report,pendingGuestReport);
  receipt=await window.BluePlateBridge.submitReport(pendingGuestReport.payload);
  if(!['created','replayed'].includes(receipt?.status)||!Number.isSafeInteger(receipt.user_review_id)||receipt.user_review_id<=0)
   throw new Error('Missing report receipt');
 }catch(error){
  reportError(guestSubmissionError(error));
  return;
 }finally{
  setGuestSubmissionPending(false);
 }
 pendingGuestReport=undefined;
 $('audit-form').reset();$('audit-restaurant')._bpClear?.();selectedNotes.clear();
 document.querySelectorAll('[data-note]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
 setRating(0);updateCancelled();
 showSubmissionConfirmation(receipt);
 try{await window.BluePlateBridge.refreshPublicReviews();}
 catch{toast('Report saved. The recent-report list could not reload.');}
}
function submitPublic(e){
 e.preventDefault();
 if(guestSubmissionPending)return;
 reportError('');
 const restaurantId=+$('audit-restaurant').value;
 const unlistedFields=$('bp-unlisted-fields');
 const unlisted=liveMode&&!syntheticDemo&&unlistedFields&&!unlistedFields.hidden
  ? {name:$('bp-unlisted-name').value.trim(),location:$('bp-unlisted-location').value.trim(),
     type:$('bp-unlisted-type').value.trim(),location_details:$('bp-unlisted-details').value.trim()}
  : null;
 if(unlisted&&!unlisted.name){reportError('Enter the restaurant name.',()=>$('bp-unlisted-name').focus());return;}
 if(unlisted&&!unlisted.location){reportError('Enter the branch or location.',()=>$('bp-unlisted-location').focus());return;}
 const outcome=document.querySelector('input[name="audit-cancelled"]:checked')?.value;
 const cancelled=outcome==='yes';
 const minutes=cancelled?null:Number($('audit-minutes').value);
 const details=$('audit-details').value.trim();
 if(!restaurantId&&!unlisted){reportError('Choose a restaurant from the suggestions.',()=>$('audit-restaurant')._bpFocus?.());return;}
 if(outcome!=='yes'&&outcome!=='no'){reportError('Choose Delivered or Cancelled.',()=>document.querySelector('input[name="audit-cancelled"]').focus());return;}
 if(!cancelled&&(!Number.isInteger(minutes)||minutes<1||minutes>240)){
  reportError('Enter a delivery time between 1 and 240 whole minutes.',()=>$('audit-minutes').focus());return;
 }
 if(!selectedRating){reportError('Choose a rating from 1 to 5 stars.',()=>$('stars').querySelector('[data-star]').focus());return;}
 if(!selectedNotes.size&&!details){reportError('Select at least one quick note or add some details.',()=>$('audit-details').focus());return;}

 if(liveMode && syntheticDemo){
  const report={id:`demo_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    restaurantId,cancelled,minutes,rating:selectedRating,
    notes:[...selectedNotes].join(', ')+(details?(selectedNotes.size?' · '+details:details):''),
    createdAt:new Date().toISOString()};
  const restaurant=state.restaurants.find(r=>r.id===restaurantId);
  if(!restaurant)return toast('Select a valid restaurant.');
  const entries=safeRead(REPORT_KEY);entries.unshift(report);
  const stored=safeWrite(REPORT_KEY,entries.slice(0,100));
  liveReports.unshift({restaurant_name:restaurant.name,zone_name:restaurant.zone,
    rating_score:report.rating,order_was_cancelled:report.cancelled,
    actual_observed_delivery_mins:report.minutes,comment_text:report.notes,
    submission_source:'BROWSER DEMO ONLY',submitted_at:report.createdAt});
  $('audit-form').reset();$('audit-restaurant')._bpClear?.();selectedNotes.clear();
  document.querySelectorAll('[data-note]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});
  setRating(0);updateCancelled();renderPublicReviews();showSubmissionConfirmation(report,restaurant,stored);
  return;
 }
 if(liveMode){
  const notes=[[...selectedNotes].join(', '),details].filter(Boolean).join(' · ');
  if([...notes].length>1000){
   reportError('Keep quick notes and written details to 1,000 characters total.',()=>$('audit-details').focus());return;
  }
  return submitGuestReport({...(unlisted?{unlisted_restaurant:unlisted}:{restaurant_key:restaurantId}),rating_score:selectedRating,
   order_was_cancelled:cancelled,actual_observed_delivery_mins:minutes,comment_text:notes});
 }
 const report={id:`report_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,restaurantId,cancelled,minutes,rating:selectedRating,notes:[...selectedNotes].join(', ')+(details?(selectedNotes.size?' · '+details:details):''),createdAt:new Date().toISOString()};
 const list=safeRead(REPORT_KEY);list.unshift(report);const stored=safeWrite(REPORT_KEY,list.slice(0,200));const r=state.restaurants.find(x=>x.id===restaurantId);r.userReviews.unshift({user:'Campus guest',mins:minutes,rating:selectedRating,cancelled,note:report.notes,time:'Just now'});if(cancelled)r.cancellationProxyPct+=3.5;
 $('audit-form').reset();$('audit-restaurant')._bpClear?.();selectedNotes.clear();document.querySelectorAll('[data-note]').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false');});setRating(0);updateCancelled();renderPublicReviews();showSubmissionConfirmation(report,r,stored);}
function renderPublicReviews(){
 if(liveMode){
  const box=$('recent-reviews');
  box.innerHTML=liveReports.length?liveReports.map(r=>{
   const score=Math.max(0,Math.min(5,Number(r.rating_score)||0));
   const outcome=r.order_was_cancelled?'Order cancelled':
    (Number.isFinite(liveNumber(r.actual_observed_delivery_mins))?`${numberText(liveNumber(r.actual_observed_delivery_mins),0)} min delivery`:'Delivery time unavailable');
   return `<article class="review"><div class="review-head"><div><div class="review-name">${html(r.restaurant_name)}</div><div class="review-meta">${html(String(r.zone_name||'').replace('UST - ',''))} · ${html(formatDateTime(r.submitted_at))}</div></div><span class="review-rating">${'★'.repeat(score)}${'☆'.repeat(5-score)}</span></div>${syntheticDemo?`<p>${html(r.comment_text)}</p>`:''}<div class="review-tags">${html(outcome)} · ${syntheticDemo?html(r.submission_source||'Guest'):'Self-reported'}</div></article>`;
  }).join(''):'<p class="muted">No database reports have been submitted yet.</p>';
  return;
 }
 const recent=reviews().slice(0,12);$('recent-reviews').innerHTML=recent.length?recent.map(({r,rev})=>`<article class="review"><div class="review-head"><div><div class="review-name">${html(r.name)}</div><div class="review-meta">${html(r.zone.replace('UST - ',''))} · ${html(rev.time||'Sample report')}</div></div><span class="review-rating">${'★'.repeat(Math.min(5,rev.rating))}${'☆'.repeat(5-Math.min(5,rev.rating))}</span></div><p>${html(rev.note)}</p><div class="review-tags">${rev.cancelled?'Order cancelled':`${Number(rev.mins)} min delivery`} · ${html(rev.user==='Campus guest'?'Guest auditor':'Sample auditor')}</div></article>`).join(''):'<p class="muted">No reports have been added yet.</p>';}

function initZoneInfo(){
 const dialog=$('bp-zone-dialog');
 const trigger=$('bp-zone-info');
 trigger.onclick=()=>{
  const counts={a:0,b:0,c:0};
  for(const row of state.restaurants){
   const distance=liveNumber(row.distance);
   if(distance===null)continue;
   const band=row.zone.match(/^Zone ([ABC]) —/)?.[1]?.toLowerCase()
    ||(distance<=.5?'a':distance<=1?'b':distance<=1.5?'c':null);
   if(band)counts[band]++;
  }
  for(const [key,count] of Object.entries(counts))$('bp-zone-count-'+key).textContent=`${count} ${count===1?'venue':'venues'}`;
  $('bp-zone-scope').textContent=currentModel?'Counts for the estimates shown.':'Counts for the restaurants shown.';
  dialog.showModal();
 };
 dialog.addEventListener('close',()=>trigger.focus());
 const metric=$('bp-metric-dialog');
 let opener;
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-metric-info]');
  if(!button)return;
  opener=button;
  const explanations={
   notices:['About delivery notices','Updates are based on restaurant information, student feedback, and delivery estimates. They are not live delivery-platform alerts.'],
   eta:['Estimated delivery time','This is an estimate of preparation, travel, and handoff time. Actual deliveries may take longer or shorter depending on traffic, weather, restaurant workload, and other conditions. The estimate does not use live traffic or weather.'],
   stress:['Delivery travel difficulty','The Transit Stress Index compares estimated travel time with an assumed 15-minute travel budget. A higher score means more of the travel budget is needed. It does not predict whether an order will be late or canceled.'],
  };
  [$('bp-metric-title').textContent,$('bp-metric-explanation').textContent]=explanations[button.dataset.metricInfo];
  metric.showModal();
 });
 metric.addEventListener('close',()=>opener?.focus());
}
function initAdmin(){document.querySelectorAll('.nav-link').forEach(btn=>{btn.onclick=()=>{scrollPending=true;activateNav(btn.dataset.nav);$(btn.dataset.target).scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>{scrollPending=false;syncNav();},1100);};});window.addEventListener('scroll',syncNav,{passive:true});
 if(!liveRequired)$('simulate-refresh').onclick=()=>{state.restaurants.forEach(r=>r.proxyDeliveryMins=Number(Math.max(15,r.proxyDeliveryMins+(Math.random()-.5)*1.3).toFixed(1)));initModeledHistory();renderAdmin();toast('Illustrative history regenerated locally. No API was contacted.');};
 $('alert-filter').onchange=renderAlerts;
 // Action Log form and note behavior are initialized below.
 $('open-sort').onclick=()=>togglePopup('sort-popover','open-sort');$('open-filter').onclick=()=>togglePopup('filter-popover','open-filter');$('open-search').onclick=openSearch;$('close-search').onclick=closeSearch;$('directory-search').oninput=renderDirectory;
 $('bp-directory-prev').onclick=()=>changeDirectoryPage(-1);
 $('bp-directory-next').onclick=()=>changeDirectoryPage(1);
 // Replace Safari's native select with a compact six-category click-to-cycle menu.
 initCyclingSortMenu();
 $('filter-street').onchange=renderDirectory;
 $('bp-demand-scenario').onchange=e=>{
  demandScenario=e.target.value;
  renderCharts();renderDirectory(true);
 };
 $('filter-zone').onchange=renderDirectory;$('filter-health').onchange=renderDirectory;$('filter-cuisine').onchange=renderDirectory;$('filter-reset').onclick=()=>{$('filter-zone').value='ALL';$('filter-health').value='ALL';$('filter-cuisine').value='ALL';$('filter-street').value='ALL';syncCompactSelects();closePopups();renderDirectory();};
 const cuisines=[...new Set(state.restaurants.map(r=>r.cuisine))].sort();$('filter-cuisine').innerHTML+=[...cuisines].map(c=>`<option value="${html(c)}">${html(c)}</option>`).join('');
 // Action Log fields are created before compact dropdowns are initialized.
 if(!liveRequired)initManagerActionLog();
 // Compact, accessible menus replace the native Safari option sheets.
 initCompactSelects();
 initPeriodToolbar();
 initZoneInfo();
 initExportControls();
 initRestaurantDetails();
 $('insights').querySelector('.section-head p').textContent=liveRequired?'Compare delivery estimates, restaurant options, and student feedback.':'Period-specific comparisons and trends using illustrative data.';
 $('trend-chart').closest('.chart-panel').querySelector('p').textContent='Modeled demand and delivery minutes, grouped by reporting period.';
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();openSearch();}});
 document.addEventListener('click',e=>{if(!e.target.closest('.tools')&&!e.target.closest('.bp-compact-select'))closePopups();if(!e.target.closest('.bp-compact-select'))closeCompactSelectMenus();});
 renderAdmin();
}

// Sort state per chosen category: Default -> Ascending -> Descending -> Default.
// The menu remains open so a second or third click is immediate.
function initCyclingSortMenu(){
 const pop=$('sort-popover');
 const options=[
   {key:'price',name:'Price',asc:'Low to high',desc:'High to low'},
   {key:'name',name:'Name',asc:'A to Z',desc:'Z to A'},
   {key:'distance',name:'Distance',asc:'Closest first',desc:'Farthest first'},
   {key:'risk',name:'Risk',asc:'Lowest first',desc:'Highest first'},
   {key:'rating',name:'Rating',asc:'Lowest first',desc:'Highest first'},
   {key:'health',name:'Health',asc:'Normal first',desc:'Critical first'}
 ];
 let activeCategory=null;
 let phase=0;
 pop.innerHTML=`<div class="sort-menu-heading">Sort by</div>
   <div class="sort-menu-list">${options.map(o=>`
     <button type="button" class="sort-choice" data-sort-key="${o.key}" aria-pressed="false">
       <span class="sort-choice-main"><span class="sort-choice-name">${o.name}</span><span class="sort-choice-mode"></span></span>
       <span class="sort-choice-check" aria-hidden="true">✓</span>
     </button>`).join('')}</div>
   <div class="sort-menu-hint">Click the same option to cycle: default → ascending → descending → default.</div>`;
 const updateMenu=()=>{
   pop.querySelectorAll('[data-sort-key]').forEach(b=>{
     const chosen=activeCategory===b.dataset.sortKey;
     const option=options.find(o=>o.key===b.dataset.sortKey);
     b.classList.toggle('is-active',chosen);
     b.setAttribute('aria-pressed',String(chosen));
     b.querySelector('.sort-choice-mode').textContent=chosen
       ?(phase===0?'Default order':phase===1?option.asc:option.desc)
       :'Click to select';
   });
 };
 pop.addEventListener('click',e=>{
   const b=e.target.closest('[data-sort-key]');
   if(!b || !pop.contains(b))return;
   if(activeCategory===b.dataset.sortKey){
     phase=(phase+1)%3;
   } else {
     activeCategory=b.dataset.sortKey;
     phase=0;
   }
   sortBy=phase===0?'default':`${activeCategory}-${phase===1?'asc':'desc'}`;
   updateMenu();
   renderDirectory();
 });
 pop.addEventListener('bp-reset-sort',()=>{activeCategory=null;phase=0;sortBy='default';updateMenu();});
 updateMenu();
}
// Reusable select enhancement for alerts, manager-note zones and restaurant filters.
// The original <select> is retained as the data source and handles existing change listeners.
function closeCompactSelectMenus(){
 document.querySelectorAll('.bp-compact-select').forEach(w=>{
   w.querySelector('.bp-option-menu')?.classList.add('hidden');
   w.querySelector('.bp-select-trigger')?.setAttribute('aria-expanded','false');
 });
}
function syncCompactSelects(){
 document.querySelectorAll('select.bp-native-select').forEach(s=>s._bpSync?.());
}
function initCompactSelects(){
 const ids=['alert-filter','note-zone','note-category','note-status','notes-filter-category','notes-filter-status','filter-zone','filter-health','filter-cuisine','bp-demand-scenario'];
 const nameOverrides={
  'note-zone':{'UST - España Blvd':'España','UST - Dapitan St':'Dapitan','UST - P. Noval St':'P. Noval','UST - Lacson Ave':'Lacson'}
 };
 for(const id of ids){
  const select=$(id);
  if(!select || select.classList.contains('bp-native-select'))continue;
  const wrap=document.createElement('div');
  wrap.className='bp-compact-select';
  wrap.dataset.selectId=id;
  const trigger=document.createElement('button');
  trigger.type='button';
  trigger.className='field bp-select-trigger';
  trigger.id=id+'-trigger';
  trigger.setAttribute('aria-haspopup','menu');
  trigger.setAttribute('aria-expanded','false');
  trigger.setAttribute('aria-controls',id+'-menu');
  const title=select.getAttribute('aria-label')||document.querySelector(`label[for="${id}"]`)?.textContent||'Select';
  const valueText=document.createElement('span');
  valueText.className='bp-select-value';
  const chevron=document.createElement('span');
  chevron.className='bp-select-chevron';
  chevron.setAttribute('aria-hidden','true');
  chevron.textContent='⌄';
  trigger.append(valueText,chevron);
  const menu=document.createElement('div');
  menu.id=id+'-menu';
  menu.className='bp-option-menu hidden';
  menu.setAttribute('role','menu');
  menu.setAttribute('aria-label',title);
  const pretty=(option)=>nameOverrides[id]?.[option.value]||option.textContent.trim();
  for(const option of Array.from(select.options)){
   const item=document.createElement('button');
   item.type='button';
   item.className='bp-option-choice';
   item.setAttribute('role','menuitemradio');
   item.setAttribute('aria-checked','false');
   item.dataset.value=option.value;
   const label=document.createElement('span');
   label.textContent=pretty(option);
   const check=document.createElement('span');
   check.className='bp-option-check';
   check.setAttribute('aria-hidden','true');
   check.textContent='✓';
   item.append(label,check);
   menu.append(item);
   item.addEventListener('click',()=>{
    select.value=option.value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    select._bpSync?.();
    closeCompactSelectMenus();
    trigger.focus({preventScroll:true});
   });
  }
  wrap.append(trigger,menu);
  select.insertAdjacentElement('afterend',wrap);
  select.classList.add('bp-native-select'); // no native Safari sheet after successful enhancement
  const matchingLabel=document.querySelector(`label[for="${id}"]`);
  if(matchingLabel)matchingLabel.setAttribute('for',trigger.id);
  function update(){
   const option=Array.from(select.options).find(o=>o.value===select.value);
   const display=option?pretty(option):'Choose an option';
   valueText.textContent=display;
   trigger.setAttribute('aria-label',`${title}: ${display}`);
   menu.querySelectorAll('.bp-option-choice').forEach(item=>{
    const chosen=item.dataset.value===select.value;
    item.classList.toggle('is-selected',chosen);
    item.setAttribute('aria-checked',String(chosen));
   });
  }
  select._bpSync=update;
  select.addEventListener('change',update);
  trigger.addEventListener('click',()=>{
   const opening=menu.classList.contains('hidden');
   closeCompactSelectMenus();
   if(opening){
    // The outer filter popup stays open while its nested selection is changed.
    if(!wrap.closest('#filter-popover'))closePopups();
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded','true');
   }
  });
  function stepFocus(current,delta){
   const items=Array.from(menu.querySelectorAll('.bp-option-choice'));
   if(!items.length)return;
   const index=items.indexOf(current);
   items[(index+delta+items.length)%items.length].focus({preventScroll:true});
  }
  trigger.addEventListener('keydown',e=>{
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();
    if(menu.classList.contains('hidden'))trigger.click();
    const selected=menu.querySelector('.is-selected');
    stepFocus(selected,e.key==='ArrowDown'?1:-1);
   } else if(e.key==='Escape' && !menu.classList.contains('hidden')){
    e.preventDefault();closeCompactSelectMenus();
   }
  });
  menu.addEventListener('keydown',e=>{
   if(e.key==='Escape'){
    e.preventDefault();closeCompactSelectMenus();trigger.focus({preventScroll:true});
   }else if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();stepFocus(e.target,e.key==='ArrowDown'?1:-1);
   }else if(e.key==='Home'||e.key==='End'){
    e.preventDefault();
    const items=menu.querySelectorAll('.bp-option-choice');
    items[e.key==='Home'?0:items.length-1]?.focus({preventScroll:true});
   }else if(e.key==='Tab')closeCompactSelectMenus();
  });
  update();
 }
}

function activateNav(key){activeNav=key;document.querySelectorAll('.nav-link').forEach(b=>{const active=b.dataset.nav===key;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function syncNav(){if(scrollPending)return;let v='overview';for(const key of ['overview','insights','alerts','restaurants']){if($(key).getBoundingClientRect().top<160)v=key;}if(v!==activeNav)activateNav(v);}
function closePopups(){closeCompactSelectMenus();for(const id of ['sort-popover','filter-popover'])$(id)?.classList.add('hidden');for(const id of ['open-sort','open-filter'])$(id)?.setAttribute('aria-expanded','false');}
function togglePopup(id,buttonId){const open=$(id).classList.contains('hidden');closePopups();$(id).classList.toggle('hidden',!open);$(buttonId).setAttribute('aria-expanded',String(open));}
function openSearch(){closePopups();$('search-strip').classList.remove('hidden');$('open-search').setAttribute('aria-expanded','true');$('restaurants').scrollIntoView({behavior:'smooth',block:'start'});$('directory-search').focus({preventScroll:true});}
function closeSearch(){$('search-strip').classList.add('hidden');$('directory-search').value='';$('open-search').setAttribute('aria-expanded','false');renderDirectory();}
function renderAdmin(){
 if(liveRequired && liveError){
  $('executive-summary').textContent=liveError;
  $('kpis').replaceChildren();
  charts.forEach(chart=>chart.destroy());charts=[];
  $('alerts-list').replaceChildren();
  $('bp-directory-coverage').hidden=true;
  const pager=$('bp-directory-pagination');if(pager)pager.hidden=true;
  $('directory-rows').replaceChildren();
  $('restaurant-count').textContent='';
  $('filter-summary').textContent='';
  return;
 }
 renderDirectoryCoverage(renderKpis());renderCharts();renderAlerts();renderNotes();renderDirectory();
}
function renderDirectoryCoverage(secondary=[]){
 const el=$('bp-directory-coverage');if(!el)return;
 el.hidden=!liveMode;if(!liveMode)return;
 const rows=state.restaurants;
 if(currentModel||(typeof studentPeriod!=='undefined'&&studentPeriod)){el.innerHTML='<summary>Coverage and supporting metrics</summary><dl class="bp-supporting-metrics">'+secondary.map(([label,value,description])=>`<div><dt>${html(label)}</dt><dd><strong>${html(value)}</strong><small>${html(description)}</small></dd></div>`).join('')+'</dl>';return;}
 const missingAddress=rows.filter(r=>!r.streetAddress).length;
 const warehouseRated=rows.filter(r=>Number.isFinite(syntheticDemo?r.recordedRating:r.publicRating)).length;
 const reportedRated=rows.filter(r=>Number.isFinite(r.selfReportedRating)).length;
 const unclassified=rows.filter(r=>/^Unclassified\b/i.test(r.cuisine)).length;
 const unassigned=rows.filter(r=>!r.zone||r.zone==='Unassigned zone').length;
 el.innerHTML='<summary>Coverage and supporting metrics</summary><div class="bp-coverage-grid">'+
  [[rows.length,'legacy BI cohort'],[missingAddress,'without a recorded street address'],
   [unassigned,'without zone assignments'],[unclassified,'unclassified cuisine'],
   [warehouseRated,'with an eligible warehouse rating in period'],[reportedRated,'with a self-reported rating in period']]
  .map(([count,label])=>`<div><strong>${html(count)}</strong><span>${html(label)}</span></div>`).join('')+
  '</div>'+
  (secondary.length?'<dl class="bp-supporting-metrics">'+secondary.map(([label,value,description])=>
   `<div><dt>${html(label)}</dt><dd><strong>${html(value)}</strong><small>${html(description)}</small></dd></div>`).join('')+'</dl>':'')+
  '<p>Address coverage excludes collector placeholders. Rating coverage follows the selected period.</p>';
}
function sampleLabel(count,singular,plural=singular+'s'){
 return `Based on ${count} ${count===1?singular:plural}`;
}
function warehouseRatingLabel(days){
 return days?sampleLabel(days,'day with an eligible rating','days with eligible ratings'):'No eligible warehouse ratings in this period';
}
function reportMetrics(report){
 const count=key=>Number(report[key]||0);
 const total=count('auditor_report_count'), ratings=count('report_rating_count');
 const completed=count('completed_delivery_count'), cancelled=count('cancelled_report_count');
 const known=count('known_outcome_count'), share=liveNumber(report.reported_cancellation_share);
 return [
  ['Accepted reports',String(total),'All stored submissions in selected period'],
  ['Self-reported rating',ratings?`${numberText(liveNumber(report.auditor_avg_rating),2)} / 5`:'Not available',ratings?sampleLabel(ratings,'rating'):'No ratings in this period'],
  ['Self-reported completed delivery',completed?`${numberText(liveNumber(report.observed_delivery_mins))} min`:'Not available',completed?sampleLabel(completed,'completed delivery','completed deliveries'):'No completed deliveries with a valid time'],
  ['Self-reported cancellation share',known&&share!==null?`${numberText(share*100)}%`:'Not available',`${cancelled} cancelled out of ${known} ${known===1?'report':'reports'} with a known outcome`]
 ];
}
const reportMethodology='Reports are a self-selected sample. Small samples describe those submissions and cannot establish restaurant performance.';
// Original warehouse planning cutoffs for modeled ETA (minutes).
const ETA_GUIDE_MINUTES = {warning:35,critical:45};
function modeledEtaGuide(minutes){
 if(!Number.isFinite(minutes))return null;
 if(minutes>=ETA_GUIDE_MINUTES.critical)return ['critical','45 min or more'];
 if(minutes>=ETA_GUIDE_MINUTES.warning)return ['warning','35 to under 45 min'];
 return ['normal','Under 35 min'];
}
function renderStudentKpis(){
 const rows=enriched();
 const avg=key=>{
  const valid=rows.map(row=>row[key]).filter(Number.isFinite);
  return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;
 };
 const [low,high,stress]=['etaLow','etaHigh','transitStress'].map(avg);
 const oldEta=studentPeriod.snapshot&&!currentModel?avg('eta'):null;
 const etaGuide=modeledEtaGuide(high??oldEta);
 const t=studentPeriod.report_totals;
 const delivered=Number(t.completed_delivery_count||0),rating=Number(t.report_rating_count||0);
 const value=(number,unit)=>number==null?'Not enough data':numberText(Number(number))+unit;
 const cards=[
  ['Restaurant options',studentPeriod.public_listings,'Restaurants listed within 1.5 km of UST.'],
  ['Estimated delivery time',low!==null&&high!==null?`${Math.round(low)}–${Math.round(high)} min`:oldEta!==null?numberText(oldEta)+' min':'Not available',
   oldEta!==null?'Average estimate from the earlier model.':'Average estimated delivery range based on distance and preparation time.','eta',etaGuide?(high!==null?'Based on the higher estimate':'Based on the earlier estimate'):null,etaGuide],
  ['Delivery travel difficulty',stress===null?'Not available':numberText(stress)+' / 100','How much of the assumed travel-time budget is used.','stress'],
  ['Reported delivery time',value(t.observed_delivery_mins,' min'),'Average delivery time shared by students.',null,sampleLabel(delivered,'completed delivery','completed deliveries')],
  ['Student rating',value(t.auditor_avg_rating,' / 5'),'Average rating from submitted student experiences.',null,sampleLabel(rating,'rating')],
  ['Student reports',t.auditor_report_count,`Feedback collected across ${t.reported_venues} ${t.reported_venues===1?'restaurant':'restaurants'}.`],
 ];
 $('kpis').innerHTML=cards.map(([name,result,description,info,sample,guide])=>`<article class="kpi${guide?' kpi--'+guide[0]:''}"><div class="bp-kpi-heading"><h3 class="k-label">${html(name)}</h3>
  ${info?`<button type="button" class="tiny-btn bp-metric-info" data-metric-info="${info}" aria-haspopup="dialog" aria-label="About ${html(name.toLowerCase())}">ⓘ</button>`:''}</div>
  <strong>${html(result)}</strong>${guide?`<span class="pill ${guide[0]} bp-kpi-guide"><span class="dot" aria-hidden="true"></span>${html(guide[1])}</span>`:''}<p class="k-caption">${html(description)}</p>${sample?`<small class="bp-kpi-sample">${html(sample)}</small>`:''}</article>`).join('');
 $('executive-summary').textContent='Compare delivery estimates and see what UST students have shared.';
 return [
  ['Restaurants analyzed',String(studentPeriod.snapshot?rows.length:0),'Restaurants with estimates for the selected dates'],
  ['Addresses listed',String(rows.filter(r=>r.streetAddress).length),'Based on restaurant information in this view'],
  ...(Number.isInteger(t.pending_unlisted_reports)?[['Unlisted reports pending review',t.pending_unlisted_reports,'Counted separately from restaurant and zone results']]:[]),
  ...(studentPeriod.snapshot&&!currentModel?[
   ['Earlier modeled order count',rows.reduce((sum,r)=>sum+(r.orderCount||0),0).toLocaleString(),'Original model assumes 25 orders per restaurant per day'],
  ]:[]),
  ...reportMetrics(t).slice(3),
 ];
}
function renderKpis(){
 if(typeof studentPeriod!=='undefined'&&studentPeriod)return renderStudentKpis();
 if(currentModel){
  const rows=enriched();
  const mean=key=>rows.reduce((sum,row)=>sum+row[key],0)/rows.length;
  const count=liveReportTotals.auditor_report_count||0;
  const cards=[
   ['Current public listings',currentModel.liveCoverage.public_listings,'Approved directory'],
   ['Modeled coverage',rows.length,'Published scenario venues'],
   ['Mean ETA range',`${mean('etaLow').toFixed(1)}–${mean('etaHigh').toFixed(1)} min`,'Modeled scenario endpoints'],
   ['Mean Transit Stress Index',mean('transitStress').toFixed(1)+' points','Travel time against a 15-minute budget'],
   ['Hypothetical orders per day',currentModel.demand_scenarios.pool[demandScenario].toLocaleString(),'Equal allocation across modeled venues'],
   ['Genuine guest reports',count,`Across ${currentModel.liveCoverage.genuine_report_venues} reported venues`],
  ];
  $('kpis').innerHTML=cards.map(([name,value,sub])=>`<div class="kpi"><div class="k-label">${html(name)}</div><strong>${html(value)}</strong><div class="k-caption">${html(sub)}</div></div>`).join('');
  $('executive-summary').textContent='Modeled delivery scenarios and genuine student reports for UST Manila.';
  return reportMetrics(liveReportTotals);
 }
 if(liveMode){
  const arr=enriched(), valid=key=>arr.map(r=>r[key]).filter(Number.isFinite), average=key=>{
    const v=valid(key);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
  const distinct=key=>new Set(arr.map(r=>r[key]).filter(x=>x&&x!=='Unassigned zone')).size;
  const eta=average('eta'),risk=average('cancellationProxyPct');
  const addresses=arr.filter(r=>String(r.streetAddress||'').trim()).length;
  const warehouseRated=valid('publicRating').length;
  const reportedRated=valid('selfReportedRating').length;
  const open=state.alerts.filter(a=>a.status!=='RESOLVED').length;
  const critical=state.alerts.filter(a=>a.status!=='RESOLVED'&&a.severity==='CRITICAL').length;
  const reports=Number(liveReportTotals.auditor_report_count||0);
  const status=(v,w,c)=>v===null?'INFO':(v>=c?'CRITICAL':v>=w?'WARNING':'NORMAL');
  const directory=['Current active restaurants',String(arr.length),'Deduplicated directory listings','INFO'];
  const warehouse=[
   ['Modeled delivery',eta===null?'Not available':`${eta.toFixed(1)} min`,syntheticDemo?'Synthetic estimate':`${valid('eta').length} restaurants with a modeled estimate`,status(eta,35,45)],
   ['Modeled risk index',risk===null?'Not available':`${risk.toFixed(1)}${syntheticDemo?'%':' points'}`,syntheticDemo?'Synthetic index':'Model-derived cancellation risk',status(risk,8,15)],
   [syntheticDemo?'Restaurants with synthetic ratings':'Restaurants with warehouse ratings',`${warehouseRated} / ${arr.length}`,syntheticDemo?'Illustrative scores':'Eligible warehouse ratings in this period','INFO'],
   [syntheticDemo?'Simulated alerts':'Open warehouse alerts',String(open),`${critical} critical in this period`,critical?'CRITICAL':open?'WARNING':'INFO']
  ];
  const reported=reportMetrics(liveReportTotals).map(metric=>[...metric,'INFO']);
  const hasWarehouse=liveTrend.length>0;
  const showReports=!syntheticDemo&&(periodPreset==='latest-report'||(periodPreset!=='latest'&&!hasWarehouse));
  const showBoth=!syntheticDemo&&periodPreset!=='latest'&&periodPreset!=='latest-report'&&hasWarehouse&&reports>0;
  const primary=showReports?reported:showBoth?[...warehouse.slice(0,2),...reported.slice(0,2)]:warehouse;
  const cards=[directory,...primary];
  const secondary=[
   ['UST zones represented',String(distinct('zone')),'Based on recorded restaurant locations'],
   ['Cuisine categories',String(distinct('cuisine')),'Includes unclassified cuisine when present'],
   ['Addresses recorded',`${addresses} / ${arr.length}`,'Excludes collector placeholders'],
   ...(syntheticDemo?[['Demo reports',String(Math.min(6,arr.length)),'Browser-local synthetic samples']]:[
    ['Restaurants with self-reported ratings',`${reportedRated} / ${arr.length}`,'Active listings with report ratings in this period'],
    ...[...warehouse,...reported].filter(metric=>!primary.includes(metric))
   ])
  ];
  $('kpis').innerHTML=cards.map(([name,value,sub,level])=>`<div class="kpi kpi--${level.toLowerCase()}"><div class="bp-kpi-heading"><div class="k-label">${html(name)}</div>${level==='INFO'?'':badge(level)}</div><strong>${html(value)}</strong><div class="k-caption">${html(sub)}</div></div>`).join('');
  $('executive-summary').textContent=syntheticDemo?'Synthetic performance data for real OpenStreetMap listings.':'Warehouse estimates and student delivery reports for UST Manila.';
  return secondary;
 }
 const arr=enriched(), avg=key=>arr.length?arr.reduce((a,r)=>a+r[key],0)/arr.length:0;
 const alerts=demoAlerts(),open=alerts.filter(a=>a.status==='OPEN'||a.status==='ACKNOWLEDGED').length,critical=alerts.filter(a=>a.status!=='RESOLVED'&&a.severity==='CRITICAL'&&!a.modeled).length;
 const guest=visibleGuestReports().length;
 // KPI cards use their semantic health status, not their position in the grid.
 // Counts are informational; modeled health indicators keep their existing thresholds.
 const m=[
  ['Sample restaurants',String(arr.length),'In the selected period','INFO'],
  ['Avg. modeled delivery',arr.length?avg('eta').toFixed(1)+' min':'—','Illustrative period mean',avg('eta')>=34?'WARNING':'NORMAL'],
  ['Modeled risk index',arr.length?avg('cancellationProxyPct').toFixed(1)+'%':'—','Not a verified cancellation rate',avg('cancellationProxyPct')>=12?'CRITICAL':avg('cancellationProxyPct')>=7?'WARNING':'NORMAL'],
  ['Avg. modeled rating',arr.length?avg('blendedRating').toFixed(2)+' / 5':'—','Illustrative period mean',avg('blendedRating')<4.3?'WARNING':'NORMAL'],
  ['Open demo alerts',String(open),`${critical} critical · snapshot only`,critical>0?'CRITICAL':open>0?'WARNING':'NORMAL'],
  ['Auditor reports',String(guest),'Browser submissions in range','INFO']
 ];
 $('kpis').innerHTML=m.map(([name,value,sub,status])=>`<div class="kpi kpi--${status.toLowerCase()}"><div class="k-label">${name}</div>${status==='INFO'?'':badge(status)}<strong>${value}</strong><div class="k-caption">${sub}</div></div>`).join('');
 $('executive-summary').textContent=`${dateRangeLabel()} · ${arr.length} illustrative restaurants · ${arr.length?avg('eta').toFixed(1)+' min modeled average delivery':'no modeled observations'} · ${guest} browser-submitted report${guest===1?'':'s'}.`;
}
function demoAlerts(){
 if(liveMode)return state.alerts;
 const list=[];
 const today=localDay(new Date());
 if(inPeriod(today))list.push(...state.alerts);
 for(const report of visibleGuestReports()){
  const r=state.restaurants.find(x=>x.id===Number(report.restaurantId));if(!r)continue;
  const curr=metrics(r);if(curr.health==='NORMAL')continue;
  list.unshift({id:report.id,severity:curr.health,zone:r.zone,restaurant:r.name,metric:'Campus guest report',message:report.cancelled?`A browser-local cancelled order was reported with ${report.rating}/5 rating.`:`Browser report: ${report.minutes} minutes delivery and ${report.rating}/5 rating.`,timestamp:formatDateTime(report.createdAt),status:'MODEL SIGNAL',modeled:true});
 }
 // Historic risk alerts are indicators from synthetic observations, not actionable live alerts.
 const matched=new Set(list.map(x=>x.restaurant));
 for(const r of enriched()){
  if(r.health==='NORMAL'||matched.has(r.name))continue;
  list.push({id:'modeled_'+r.id,severity:r.health,zone:r.zone,restaurant:r.name,metric:'Illustrative period signal',message:`Modeled delivery ${r.eta.toFixed(1)} min, risk index ${r.cancellationProxyPct.toFixed(1)}%, and rating ${r.blendedRating.toFixed(2)} for ${dateRangeLabel().toLowerCase()}.`,timestamp:dateRangeLabel(),status:'MODEL SIGNAL',modeled:true});
 }
 return list;
}
function renderStudentNotices(){
 const t=studentPeriod.report_totals;
 const count=Number(t.reported_venues||0), total=studentPeriod.public_listings;
 const notices=[];
 const add=(style,label,icon,title,text,date)=>notices.push({style,label,icon,title,text,date});
 if(studentPeriod.snapshot){
  const rows=enriched();
  const long=rows.filter(row=>modeledEtaGuide(currentModel?row.etaHigh:row.eta)?.[0]!=='normal'
   && Number.isFinite(currentModel?row.etaHigh:row.eta)).length;
  if(long)add('caution','Estimate advisory','!', 'Allow extra time',
   `${long} ${long===1?'restaurant has':'restaurants have'} an estimate of at least 35 minutes. Check the estimate before you order.`);
  const budget=rows.filter(row=>row.transitStress>=100).length;
  if(budget)add('caution','Estimate advisory','!','More estimated travel time',
   `${budget} ${budget===1?'restaurant reaches':'restaurants reach'} the assumed travel-time budget. Check the estimate if you need delivery soon.`);
 }
 if(count<total)add(count?'info':'neutral','Student feedback','i', count?'Limited student feedback':'No student reports for these dates',
  count?`Feedback is available for ${count} of ${total} restaurants. More reports will help improve our insights.`:
   'Delivery estimates and restaurant listings can still help you compare options.');
 const updated=warehouseFreshness?.directory_updated_at;
 const date=updated?.slice(0,10), range=studentPeriod.period;
 if(date&&(!range||(date>=range.from&&date<=range.to))){
  const closed=Number(studentPeriod.reviewed_closures||0);
  add('positive','Directory update','✓','Restaurant list updated',
   closed?`${closed} previously listed ${closed===1?'restaurant was':'restaurants were'} removed following closure confirmations.`:'The latest restaurant listings are available.',date);
 }
 $('alerts-list').innerHTML=notices.length?notices.map(({style,label,icon,title,text,date})=>
  `<article class="bp-student-notice bp-notice-${style}"><span class="bp-notice-icon" role="img" aria-label="${html(label)}">${html(icon)}</span><div><h3>${html(title)}</h3><p>${style==='caution'?'<span class="sr-only">Estimate advisory. </span>':''}${html(text)}</p>${date?`<time datetime="${html(date)}">${html(prettyManila(date))}</time>`:''}</div></article>`).join(''):
  '<p class="empty">No delivery notices for these dates.</p>';
}
function renderAlerts(){
 if(studentPeriod){renderStudentNotices();return;}
 if(currentModel){
  $('alerts-list').innerHTML='<div class="empty">This snapshot estimates transit stress. Operational alerts require observed inputs and remain in the historical view.</div>';
  return;
 }
 if(liveMode){
  const filter=$('alert-filter').value;
  const arr=state.alerts.filter(a=>filter==='ALL'||(filter==='OPEN'?a.status!=='RESOLVED':a.severity===filter));
  $('alerts-list').innerHTML=arr.length?arr.map(a=>`<div class="alert-row"><div class="alert-main"><div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">${badge(a.severity)}<h3 style="margin:0">${html(a.restaurant)}</h3></div><div class="alert-meta">${html(a.zone)} · ${html(a.timestamp)} · ${html(a.status)}</div><p>${html(a.message)}</p></div><div class="alert-actions">${syntheticDemo?`<button type="button" class="tiny-btn" data-demo-alert="${html(a.id)}">Add demo action</button><span class="small muted">SYNTHETIC · no real alert</span>`:'<span class="small muted">Warehouse · read-only until manager login</span>'}</div></div>`).join(''):'<div class="empty">No alerts in this period and filter.</div>';
  if(syntheticDemo)$('alerts-list').querySelectorAll('[data-demo-alert]').forEach(b=>b.onclick=()=>{
   const a=state.alerts.find(x=>String(x.id)===b.dataset.demoAlert);if(a)startActionFromAlert(a);
  });
  return;
 }
 const filter=$('alert-filter').value;
 const arr=demoAlerts().filter(a=>filter==='ALL'||(filter==='OPEN'?a.status==='OPEN'||a.status==='ACKNOWLEDGED':a.severity===filter));
 $('alerts-list').innerHTML=arr.length?arr.map(a=>`<div class="alert-row"><div class="alert-main"><div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">${badge(a.severity)} <h3 style="margin:0">${html(a.restaurant)}</h3></div><div class="alert-meta">${html(a.zone)} · ${html(a.timestamp)} · ${html(a.status)}</div><p>${html(a.message)}</p></div><div class="alert-actions"><button type="button" class="tiny-btn bp-note-from-alert" data-alert-note="${html(a.id)}">Add manager note</button>${a.modeled?'<span class="small muted">Illustrative only</span>':a.status!=='RESOLVED'?`<button type="button" class="tiny-btn" data-alert-id="${html(a.id)}" data-alert-action="ACKNOWLEDGED">Acknowledge</button><button type="button" class="tiny-btn primary" data-alert-id="${html(a.id)}" data-alert-action="RESOLVED">Resolve</button>`:'<span class="small muted">Resolved</span>'}</div></div>`).join(''):'<div class="empty">No alerts or modeled signals for this selection.</div>';
 $('alerts-list').querySelectorAll('[data-alert-id]').forEach(b=>b.onclick=()=>{const a=state.alerts.find(x=>String(x.id)===b.dataset.alertId);if(a){a.status=b.dataset.alertAction;renderKpis();renderAlerts();toast('Demo alert updated.');}});
 $('alerts-list').querySelectorAll('[data-alert-note]').forEach(b=>b.onclick=()=>{const alert=demoAlerts().find(a=>String(a.id)===b.dataset.alertNote);if(alert)startActionFromAlert(alert);});
}
// BluePlate V8: browser-local Manager Action Log. Not a shared issue-tracking backend.
const ACTION_STATUSES = {OPEN:'Open', IN_PROGRESS:'In Progress', RESOLVED:'Resolved'};
const ACTION_CATEGORIES = ['Delivery Delay','Pickup Issue','Traffic','Restaurant Issue','Customer Feedback','General Observation'];
function saveActionNotes(){
 if(!safeWrite(ACTION_NOTE_KEY,actionNotes.slice(0,300)))toast('Browser storage is unavailable; changes last only until the page reloads.');
}
function initActionData(){
 let stored=null;
 try{const raw=localStorage.getItem(ACTION_NOTE_KEY);if(raw!==null){const parsed=JSON.parse(raw);if(Array.isArray(parsed))stored=parsed;}}catch(e){}
 if(stored!==null){
  actionNotes=stored.filter(n=>n&&typeof n==='object').map((n,i)=>({
   id:String(n.id||`imported_${i}`),
   zone:String(n.zone||'UST - España Blvd'),
   restaurantId:Number(n.restaurantId)||null,
   category:ACTION_CATEGORIES.includes(n.category)?n.category:'General Observation',
   status:Object.prototype.hasOwnProperty.call(ACTION_STATUSES,n.status)?n.status:'OPEN',
   text:String(n.text||'').slice(0,600),
   createdAt:n.createdAt||null,updatedAt:n.updatedAt||null,
   alertId:n.alertId?String(n.alertId):null,
   alertLabel:n.alertLabel?String(n.alertLabel):null,
   sample:!!n.sample
  }));
 }else{
  // The two bundled example notes and previous browser-saved notes are migrated, not lost.
  actionNotes=state.managerNotes.map((n,i)=>({
   id:`legacy_${i}_${Math.abs(String(n.text||'').length)}`,
   zone:n.zone||'UST - España Blvd',restaurantId:null,category:'General Observation',
   status:'OPEN',text:String(n.text||'').slice(0,600),createdAt:null,updatedAt:null,
   alertId:null,alertLabel:null,sample:i>=safeRead(NOTE_KEY).length
  }));
  safeWrite(ACTION_NOTE_KEY,actionNotes);
 }
}
function actionRestaurant(id){return state.restaurants.find(r=>r.id===Number(id))||null;}
function setActionRestaurant(r){
 actionRestaurantId=r?r.id:null;
 const input=$('note-restaurant-search');
 input.value=r?`${r.name} · ${r.branch}`:'';
 input.classList.toggle('bp-action-valid',!!r);
 $('note-restaurant-hint').textContent=r?'✓ Restaurant selected; UST zone filled automatically.':'Optional: type and select a listed restaurant, or leave blank for a zone-wide note.';
 if(r){$('note-zone').value=r.zone;syncCompactSelects();}
 closeActionSuggestions();
}
function closeActionSuggestions(){
 $('note-restaurant-options')?.classList.add('hidden');
 $('note-restaurant-search')?.setAttribute('aria-expanded','false');
}
function initActionRestaurantSearch(){
 const input=$('note-restaurant-search'), menu=$('note-restaurant-options');
 const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 let choices=[];let active=-1;
 function select(r){setActionRestaurant(r);input.focus({preventScroll:true});}
 function render(){
  const q=normalize(input.value).trim();
  choices=state.restaurants.filter(r=>normalize([r.name,r.branch,r.cuisine,r.zone].join(' ')).includes(q)).slice(0,8);
  active=-1;
  menu.innerHTML=choices.length?`<div class="bp-action-suggestion-caption">${q?'Matching restaurants':'Sample restaurants'}</div>`+choices.map((r,i)=>`<button type="button" role="option" aria-selected="false" class="bp-action-suggestion" data-action-option="${r.id}" id="action-option-${i}"><strong>${html(r.name)}</strong><span>${html(r.branch)} · ${html(r.zone.replace('UST - ',''))}</span></button>`).join(''):'<div class="bp-action-none">No matching sample restaurants. Leave this empty to create a zone-wide note.</div>';
  menu.classList.remove('hidden');input.setAttribute('aria-expanded','true');
 }
 input.addEventListener('focus',render);
 input.addEventListener('input',()=>{actionRestaurantId=null;input.classList.remove('bp-action-valid');$('note-restaurant-hint').textContent='Select a suggestion to link the restaurant, or clear this field for a zone-wide note.';render();});
 input.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeActionSuggestions();return;}
  if(e.key==='Tab'){closeActionSuggestions();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
   e.preventDefault();if(menu.classList.contains('hidden'))render();
   if(!choices.length)return;
   active=(active+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
   menu.querySelectorAll('[data-action-option]').forEach((el,i)=>{el.classList.toggle('is-active',i===active);el.setAttribute('aria-selected',String(i===active));});
   input.setAttribute('aria-activedescendant',`action-option-${active}`);
  }else if(e.key==='Enter'&&!menu.classList.contains('hidden')&&choices.length&&(active>=0||choices.length===1)){
   e.preventDefault();select(choices[active>=0?active:0]);
  }
 });
 menu.addEventListener('pointerdown',e=>{if(e.target.closest('[data-action-option]'))e.preventDefault();});
 menu.addEventListener('click',e=>{const b=e.target.closest('[data-action-option]');if(b)select(actionRestaurant(b.dataset.actionOption));});
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('.bp-action-restaurant'))closeActionSuggestions();});
 $('note-zone').addEventListener('change',()=>{
  const r=actionRestaurant(actionRestaurantId);
  if(r&&r.zone!==$('note-zone').value){setActionRestaurant(null);toast('Restaurant link cleared because the zone changed.');}
 });
}
function initManagerActionLog(){
 const form=$('manager-note-form');
 if(!form||form.dataset.enhanced)return;
 form.dataset.enhanced='true';
 const heading=form.previousElementSibling;
 heading.querySelector('h2').textContent='Manager Action Log';
 heading.querySelector('p').textContent='Document an operational issue, assign a follow-up status, and track the resolution. Stored in this browser demo only.';
 form.className='bp-action-form';
 form.innerHTML=`
  <div id="note-linked-alert" class="bp-action-linked hidden" aria-live="polite"></div>
  <div class="bp-action-fields">
   <div class="bp-action-field"><label for="note-zone">UST zone</label><select id="note-zone" class="field"><option>UST - España Blvd</option><option>UST - Dapitan St</option><option>UST - P. Noval St</option><option>UST - Lacson Ave</option></select></div>
   <div class="bp-action-field bp-action-restaurant"><label for="note-restaurant-search">Restaurant <span class="bp-action-optional">optional</span></label><input id="note-restaurant-search" type="search" class="field" autocomplete="off" placeholder="Search a sample restaurant…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="note-restaurant-options"><div id="note-restaurant-options" class="bp-action-suggestions hidden" role="listbox" aria-label="Restaurant suggestions"></div><div id="note-restaurant-hint" class="bp-action-hint">Optional: type and select a listed restaurant, or leave blank for a zone-wide note.</div></div>
   <div class="bp-action-field"><label for="note-category">Category</label><select id="note-category" class="field">${ACTION_CATEGORIES.map(c=>`<option value="${html(c)}">${html(c)}</option>`).join('')}</select></div>
   <div class="bp-action-field"><label for="note-status">Follow-up status</label><select id="note-status" class="field"><option value="OPEN">Open</option><option value="IN_PROGRESS">In Progress</option><option value="RESOLVED">Resolved</option></select></div>
  </div>
  <div class="bp-action-field bp-action-message"><label for="note-text">Manager observation / next action</label><textarea id="note-text" class="field" rows="3" minlength="3" maxlength="600" required placeholder="Describe the issue, the proposed next action, or the resolution…"></textarea><span class="bp-action-hint">Explain what needs follow-up. Do not add private personal information.</span></div>
  <div class="bp-action-buttons"><button id="note-submit" type="submit" class="btn">Save action</button><button id="note-cancel-edit" type="button" class="btn secondary hidden">Cancel edit</button><button id="note-unlink-alert" type="button" class="bp-action-link-clear hidden">Remove alert link</button></div>`;
 const toolbar=document.createElement('div');
 toolbar.className='bp-log-toolbar';
 toolbar.innerHTML=`<div class="bp-log-top"><div><h3>Follow-up history</h3><p id="notes-summary">Local demonstration records</p></div><div class="bp-log-counts" id="notes-counts"></div></div><div class="bp-log-filters"><label class="bp-action-field" for="notes-search">Search restaurant or note<input type="search" id="notes-search" class="field" placeholder="Restaurant, zone, or keywords…"></label><div class="bp-action-field"><label for="notes-filter-category">Category</label><select id="notes-filter-category" class="field"><option value="ALL">All categories</option>${ACTION_CATEGORIES.map(c=>`<option value="${html(c)}">${html(c)}</option>`).join('')}</select></div><div class="bp-action-field"><label for="notes-filter-status">Status</label><select id="notes-filter-status" class="field"><option value="ALL">All statuses</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In Progress</option><option value="RESOLVED">Resolved</option></select></div><button type="button" id="notes-clear-filters" class="tiny-btn">Clear filters</button></div>`;
 form.insertAdjacentElement('afterend',toolbar);
 const list=$('manager-notes');list.classList.add('bp-action-list');
 initActionData();
 initActionRestaurantSearch();
 form.onsubmit=e=>{
  e.preventDefault();
  const text=$('note-text').value.trim();
  const typed=$('note-restaurant-search').value.trim();
  if(typed&&!actionRestaurantId){toast('Select a suggested restaurant or clear the field for a zone-wide note.');$('note-restaurant-search').focus();return;}
  if(text.length<3){toast('Add a short description of the action.');$('note-text').focus();return;}
  const now=new Date().toISOString();
  const existing=actionNotes.find(n=>n.id===editingActionId);
  const record={
   id:existing?.id||`action_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
   zone:$('note-zone').value,restaurantId:actionRestaurantId,
   category:$('note-category').value,status:$('note-status').value,text,
   createdAt:existing?.createdAt||now,updatedAt:now,
   alertId:linkedActionAlert?.id||null,alertLabel:linkedActionAlert?.label||null,sample:false
  };
  if(existing)actionNotes[actionNotes.indexOf(existing)]=record;else actionNotes.unshift(record);
  saveActionNotes();renderNotes();resetActionForm();
  toast(existing?'Manager action updated in this browser.':'Manager action saved in this browser.');
 };
 $('note-cancel-edit').onclick=resetActionForm;
 $('note-unlink-alert').onclick=()=>{linkedActionAlert=null;updateActionLink();};
 for(const id of ['notes-search','notes-filter-status','notes-filter-category'])$(id).addEventListener(id==='notes-search'?'input':'change',renderNotes);
 $('notes-clear-filters').onclick=()=>{$('notes-search').value='';$('notes-filter-status').value='ALL';$('notes-filter-category').value='ALL';syncCompactSelects();renderNotes();};
 list.addEventListener('click',e=>{
  const edit=e.target.closest('[data-action-edit]');
  if(edit){editActionRecord(edit.dataset.actionEdit);return;}
  const toggle=e.target.closest('[data-action-status-toggle]');
  if(toggle){const panel=toggle.nextElementSibling;const opening=panel.classList.contains('hidden');list.querySelectorAll('.bp-action-status-menu').forEach(m=>m.classList.add('hidden'));list.querySelectorAll('[data-action-status-toggle]').forEach(b=>b.setAttribute('aria-expanded','false'));panel.classList.toggle('hidden',!opening);toggle.setAttribute('aria-expanded',String(opening));return;}
  const set=e.target.closest('[data-action-status-set]');
  if(set){const n=actionNotes.find(x=>x.id===set.dataset.actionId);if(n){n.status=set.dataset.actionStatusSet;n.updatedAt=new Date().toISOString();saveActionNotes();renderNotes();toast(`Marked ${ACTION_STATUSES[n.status].toLowerCase()}.`);}return;}
  const del=e.target.closest('[data-action-delete]');
  if(del){pendingActionDelete=del.dataset.actionDelete;renderNotes();return;}
  const cancel=e.target.closest('[data-action-cancel-delete]');
  if(cancel){pendingActionDelete=null;renderNotes();return;}
  const confirm=e.target.closest('[data-action-confirm-delete]');
  if(confirm){const id=confirm.dataset.actionConfirmDelete;actionNotes=actionNotes.filter(n=>n.id!==id);pendingActionDelete=null;if(editingActionId===id)resetActionForm();saveActionNotes();renderNotes();toast('Manager action deleted from this browser.');}
 });
 document.addEventListener('click',e=>{if(!e.target.closest('.bp-action-status-picker')){list.querySelectorAll('.bp-action-status-menu').forEach(m=>m.classList.add('hidden'));list.querySelectorAll('[data-action-status-toggle]').forEach(b=>b.setAttribute('aria-expanded','false'));}});
 resetActionForm();renderNotes();
}
function updateActionLink(){
 const box=$('note-linked-alert');if(!box)return;
 box.classList.toggle('hidden',!linkedActionAlert);
 $('note-unlink-alert').classList.toggle('hidden',!linkedActionAlert);
 if(linkedActionAlert)box.innerHTML=`<strong>Linked to ${html(linkedActionAlert.label)}</strong><span>Reference only · a modeled alert is illustrative and not automatically resolved by this action.</span>`;
 else box.replaceChildren();
}
function resetActionForm(){
 editingActionId=null;actionRestaurantId=null;linkedActionAlert=null;
 const form=$('manager-note-form');form.reset();
 $('note-zone').value='UST - España Blvd';$('note-category').value='General Observation';$('note-status').value='OPEN';
 $('note-text').value='';setActionRestaurant(null);syncCompactSelects();
 $('note-submit').textContent='Save action';$('note-cancel-edit').classList.add('hidden');updateActionLink();
}
function editActionRecord(id){
 const n=actionNotes.find(x=>x.id===id);if(!n)return;
 editingActionId=n.id;linkedActionAlert=n.alertId?{id:n.alertId,label:n.alertLabel||'alert'}:null;
 $('note-zone').value=n.zone;$('note-category').value=n.category;$('note-status').value=n.status;$('note-text').value=n.text;
 setActionRestaurant(actionRestaurant(n.restaurantId));
 if(!n.restaurantId)$('note-zone').value=n.zone;
 syncCompactSelects();updateActionLink();
 $('note-submit').textContent='Save changes';$('note-cancel-edit').classList.remove('hidden');
 $('manager-note-form').scrollIntoView({behavior:'smooth',block:'center'});
 $('note-text').focus({preventScroll:true});
}
function startActionFromAlert(alert){
 resetActionForm();
 $('note-zone').value=alert.zone;
 const restaurant=state.restaurants.find(r=>r.name===alert.restaurant);
 if(restaurant)setActionRestaurant(restaurant);
 $('note-category').value=/deliver|eta/i.test(alert.metric||alert.message)?'Delivery Delay':/traffic/i.test(alert.message)?'Traffic':'Restaurant Issue';
 $('note-status').value='OPEN';
 linkedActionAlert={id:String(alert.id),label:`${alert.restaurant} · ${alert.severity} ${alert.modeled?'model signal':'demo alert'}`};
 $('note-text').value=alert.modeled?`Review illustrative ${alert.severity.toLowerCase()} signal and verify operational data before taking action. ${alert.message}`.slice(0,600):`Investigate demo alert and document follow-up: ${alert.message}`.slice(0,600);
 syncCompactSelects();updateActionLink();
 $('manager-note-form').scrollIntoView({behavior:'smooth',block:'center'});
 $('note-text').focus({preventScroll:true});
 toast('Alert information copied into a new manager action. Review before saving.');
}
function renderNotes(){
 if(liveMode && !syntheticDemo){
  const panel=$('manager-notes');if(panel)panel.innerHTML='<div class="bp-action-empty">Manager Action Log is read-only in live mode until authenticated manager sessions are implemented. No browser-only actions will be misrepresented as database records.</div>';
  const f=$('manager-note-form');if(f)f.classList.add('hidden');
  const bar=document.querySelector('.bp-log-toolbar');if(bar)bar.classList.add('hidden');
  return;
 }
 if(liveMode && syntheticDemo){
  $('manager-note-form')?.classList.remove('hidden');
  document.querySelector('.bp-log-toolbar')?.classList.remove('hidden');
  const note=$('manager-note-form')?.previousElementSibling?.querySelector('p');
  if(note)note.textContent='SYNTHETIC DEMO — browser-only action records, not a shared audit trail.';
 }
 const list=$('manager-notes');if(!list||!$('notes-search'))return;
 const q=$('notes-search').value.trim().toLocaleLowerCase();
 const category=$('notes-filter-category').value,status=$('notes-filter-status').value;
 const counts={OPEN:0,IN_PROGRESS:0,RESOLVED:0};
 actionNotes.forEach(n=>{if(counts[n.status]!==undefined)counts[n.status]++;});
 $('notes-counts').innerHTML=`<span class="bp-action-stat bp-action-stat--open">${counts.OPEN} open</span><span class="bp-action-stat bp-action-stat--progress">${counts.IN_PROGRESS} in progress</span><span class="bp-action-stat bp-action-stat--resolved">${counts.RESOLVED} resolved</span>`;
 const visible=actionNotes.filter(n=>(category==='ALL'||n.category===category)&&(status==='ALL'||n.status===status)&&(!q||[n.text,n.zone,n.category,actionRestaurant(n.restaurantId)?.name||'',actionRestaurant(n.restaurantId)?.branch||''].some(s=>String(s).toLocaleLowerCase().includes(q))));
 $('notes-summary').textContent=`Showing ${visible.length} of ${actionNotes.length} action${actionNotes.length===1?'':'s'} · browser-local demonstration`;
 list.innerHTML=visible.length?visible.map(n=>{
  const restaurant=actionRestaurant(n.restaurantId);
  const when=n.createdAt?formatDateTime(n.createdAt):(n.sample?'Bundled sample note':'Earlier browser note · timestamp unavailable');
  const edited=n.updatedAt&&n.updatedAt!==n.createdAt?` · Updated ${formatDateTime(n.updatedAt)}`:'';
  const statusName=ACTION_STATUSES[n.status]||'Open';
  return `<article class="bp-action-item" data-action-record="${html(n.id)}">
   <div class="bp-action-item-head"><div class="bp-action-item-heading"><strong>${html(restaurant?.name||n.zone.replace('UST - ',''))}</strong><span>${html(n.zone.replace('UST - ',''))} · ${html(n.category)}</span></div>
   <div class="bp-action-status-picker"><button type="button" class="bp-action-status bp-action-status--${n.status.toLowerCase()}" aria-expanded="false" data-action-status-toggle="${html(n.id)}" aria-label="Change status: ${html(statusName)}">● ${html(statusName)} <span aria-hidden="true">⌄</span></button><div class="bp-action-status-menu hidden" role="menu" aria-label="Choose follow-up status">${Object.entries(ACTION_STATUSES).map(([k,l])=>`<button type="button" role="menuitemradio" aria-checked="${k===n.status}" data-action-id="${html(n.id)}" data-action-status-set="${k}">${html(l)} ${k===n.status?'✓':''}</button>`).join('')}</div></div></div>
   <p class="bp-action-item-text">${html(n.text).replace(/\n/g,'<br>')}</p>
   ${n.alertId?`<div class="bp-action-alert-ref">Linked alert: ${html(n.alertLabel||n.alertId)} <span>· reference only</span></div>`:''}
   <div class="bp-action-item-foot"><span class="bp-action-date">${html(when+edited)}</span><div class="bp-action-item-actions">${pendingActionDelete===n.id?`<span class="bp-action-confirm-label">Delete this action?</span><button type="button" class="tiny-btn bp-action-confirm-danger" data-action-confirm-delete="${html(n.id)}">Confirm delete</button><button type="button" class="tiny-btn" data-action-cancel-delete="${html(n.id)}">Cancel</button>`:`<button type="button" class="tiny-btn" data-action-edit="${html(n.id)}">Edit</button><button type="button" class="tiny-btn" data-action-delete="${html(n.id)}">Delete</button>`}</div></div>
  </article>`;
 }).join(''):`<div class="bp-action-empty">No actions match these filters. ${actionNotes.length?'Try clearing a filter.':'Use the form above to record the first action.'}</div>`;
}

function directoryRows(){
 const query=$('directory-search').value.trim().toLocaleLowerCase(),zone=$('filter-zone').value,health=$('filter-health').value,cuisine=$('filter-cuisine').value,street=$('filter-street').value;
 let arr=enriched().filter(r=>(!query||[r.name,r.branch,r.streetAddress,r.cuisine,r.zone].some(s=>String(s||'').toLowerCase().includes(query)))&&(zone==='ALL'||r.zone===zone)&&(health==='ALL'||r.health===health)&&(cuisine==='ALL'||r.cuisine===cuisine)&&(!currentModel||street==='ALL'||r.areas?.includes(street)));
 if(sortBy!=='default'){
  const sign=sortBy.endsWith('asc')?1:-1,type=sortBy.split('-')[0],priorities={NORMAL:0,WARNING:1,CRITICAL:2};
  arr.sort((a,b)=>{if(liveMode && type!=='name'){const key={distance:'distance',price:'avgPricePhp',risk:'cancellationProxyPct',rating:currentModel||(typeof studentPeriod!=='undefined'&&studentPeriod)?'selfReportedRating':'publicRating'}[type];if(key){const va=key==='distance'&&a[key]===999?null:a[key],vb=key==='distance'&&b[key]===999?null:b[key];if(va===null&&vb!==null)return 1;if(vb===null&&va!==null)return -1;}if(type==='health'){if(a.health==='UNKNOWN'&&b.health!=='UNKNOWN')return 1;if(b.health==='UNKNOWN'&&a.health!=='UNKNOWN')return -1;}}let d=0;switch(type){case'distance':d=a.distance-b.distance;break;case'name':d=a.name.localeCompare(b.name);break;case'price':d=a.avgPricePhp-b.avgPricePhp;break;case'risk':d=currentModel?a.transitStress-b.transitStress:a.cancellationProxyPct-b.cancellationProxyPct;break;case'rating':if(currentModel||(typeof studentPeriod!=='undefined'&&studentPeriod)){if(a.selfReportedRating===null&&b.selfReportedRating!==null)return 1;if(b.selfReportedRating===null&&a.selfReportedRating!==null)return -1;}d=liveMode?((currentModel||(typeof studentPeriod!=='undefined'&&studentPeriod))?a.selfReportedRating-b.selfReportedRating:a.publicRating-b.publicRating):a.blendedRating-b.blendedRating;break;case'health':d=priorities[a.health]-priorities[b.health];break;}return d*sign||a.name.localeCompare(b.name);});
 }
 return arr;
}
function directoryPageRows(rows){
 const total=rows.length, pages=Math.ceil(total/DIRECTORY_PAGE_SIZE);
 directoryPage=Math.max(1,Math.min(directoryPage,pages));
 const start=(directoryPage-1)*DIRECTORY_PAGE_SIZE,end=Math.min(start+DIRECTORY_PAGE_SIZE,total);
 $('restaurant-count').textContent=`· ${total} matching ${total===1?'result':'results'}`;
 $('bp-directory-pagination').hidden=false;
 $('bp-directory-prev').disabled=directoryPage===1;
 $('bp-directory-next').disabled=directoryPage>=pages;
 $('bp-directory-position').textContent=total?`Page ${directoryPage} of ${pages} · Showing ${start+1}–${end}`:'No matching results';
 return rows.slice(start,end);
}
function changeDirectoryPage(delta){
 directoryPage+=delta;
 renderDirectory(true);
 const current=$(delta>0?'bp-directory-next':'bp-directory-prev');
 if(current.disabled)$(delta>0?'bp-directory-prev':'bp-directory-next').focus();
}
function renderDirectory(keepPage=false){
 if(keepPage!==true)directoryPage=1;
 const arr=directoryPageRows(directoryRows()),query=$('directory-search').value.trim();
 const zone=$('filter-zone').value,health=$('filter-health').value,cuisine=$('filter-cuisine').value;
 const labels={'default':liveMode?'Default order':'Original sample order','distance-asc':'Distance · closest first','distance-desc':'Distance · farthest first','name-asc':'Name · A to Z','name-desc':'Name · Z to A','price-asc':'Price · low to high','price-desc':'Price · high to low','risk-desc':'Risk · highest first','risk-asc':'Risk · lowest first','rating-desc':'Rating · highest first','rating-asc':'Rating · lowest first','health-desc':'Health · critical first','health-asc':'Health · normal first'};
 const filterCount=[zone,health,cuisine,$('filter-street').value].filter(x=>x!=='ALL').length;
 $('filter-summary').textContent=`${currentModel?currentModel.snapshot_date_manila:dateRangeLabel()} · ${currentModel?labels[sortBy].replace('Risk','Transit stress'):labels[sortBy]}${filterCount?` · ${filterCount} active ${filterCount===1?'filter':'filters'}`:''}${query?' · Search applied':''}`;
 if(liveMode){
  $('directory-rows').innerHTML=arr.length?arr.map(liveDirectoryRow).join(''):'<tr><td colspan="8" class="empty">No restaurants match your search or filters.</td></tr>';
  return;
 }
 $('directory-rows').innerHTML=arr.length?arr.map(r=>`<tr><td><button type="button" class="bp-restaurant-detail-link" data-restaurant-detail="${r.id}" aria-label="View performance details for ${html(r.name)}">${html(r.name)} <span aria-hidden="true">↗</span></button><div class="cell-sub">${html(r.cuisine)}</div></td><td>${html(r.zone.replace('UST - ',''))}<div class="cell-sub">${html(r.nearestGate.split(' (')[0])}</div></td><td>${r.distance.toFixed(2)} km</td><td>₱${r.avgPricePhp.toFixed(0)} avg<div class="cell-sub">${html(r.priceRange)}</div></td><td>${r.eta.toFixed(1)} min<div class="cell-sub">${r.verified===null?'Modeled estimate':`Auditor ${r.verified} min`}</div></td><td>${r.cancellationProxyPct.toFixed(1)}%</td><td>${r.blendedRating.toFixed(2)} ★</td><td>${badge(r.health)}</td></tr>`).join(''):'<tr><td colspan="8" class="empty">No restaurants match this date range, search, or filters.</td></tr>';
}
function liveDirectoryRow(r){
 if(currentModel||(typeof studentPeriod!=='undefined'&&studentPeriod))return `<tr class="bp-current-directory-row">

  <td><button type="button" class="bp-restaurant-detail-link" data-restaurant-detail="${r.id}">${html(r.name)} <span aria-hidden="true">↗</span></button></td>
  <td>${zoneTag(r)}<div class="cell-sub bp-directory-address">${html(r.streetAddress||'Address unavailable')}</div></td>
  <td>${r.distance===999?'—':numberText(r.distance*1000,0)+' m'}</td><td>${currentModel?numberText(r.etaLow)+'–'+numberText(r.etaHigh)+' min':r.eta===null?'—':numberText(r.eta)+' min'}</td>
  <td>${Number.isFinite(r.transitStress)?numberText(r.transitStress)+' / 100':'—'}</td><td>${numberText(r.orderCount,2)}</td>
  <td>${r.selfReportedRating===null?'—':numberText(r.selfReportedRating,2)+' ★'}</td><td>${r.reportCount}</td>
 </tr>`;
 const warehouseRating=(syntheticDemo||r.warehouseRatingDays>0)&&Number.isFinite(r.publicRating);
 const price=Number.isFinite(r.avgPricePhp)?`₱${numberText(r.avgPricePhp,0)}<div class="cell-sub">${syntheticDemo?'Synthetic average':'Modeled average'}</div>`:'Not available';
 const rating=warehouseRating?`${numberText(r.publicRating,2)} ★`:'Not available';
 const outcome=Number.isFinite(r.eta)?`${numberText(r.eta)} min`:'Not available';
 return `<tr>
  <td><button type="button" class="bp-restaurant-detail-link" data-restaurant-detail="${r.id}">${html(r.name)} <span aria-hidden="true">↗</span></button><div class="cell-sub">${html(r.cuisine)}</div></td>
  <td>${html(String(r.zone||'Unassigned zone').replace('UST - ',''))}<div class="cell-sub">${html(r.branch||'Address not available')}</div></td>
  <td>${r.distance===999?'Not available':r.distance.toFixed(2)+' km'}</td>
  <td>${price}</td>
  <td>${outcome}${Number.isFinite(r.eta)?`<div class="cell-sub">${syntheticDemo?'Synthetic estimate':'Modeled estimate'}</div>`:''}</td>
  <td>${Number.isFinite(r.cancellationProxyPct)?numberText(r.cancellationProxyPct)+(syntheticDemo?'%':' points'):'Not available'}</td>
  <td>${rating}<div class="cell-sub">${syntheticDemo?'Synthetic rating':html(warehouseRatingLabel(r.warehouseRatingDays))}</div>${!syntheticDemo&&Number.isFinite(r.selfReportedRating)&&r.reportRatingCount>0?`<div class="cell-sub">Self-reported: ${numberText(r.selfReportedRating,2)} ★ · ${html(sampleLabel(r.reportRatingCount,'rating'))}</div>`:''}</td>
  <td>${r.health==='UNKNOWN'?'<span class="pill unknown">Unknown</span>':badge(r.health)}</td>
 </tr>`;
}
function zoneTag(row){
 const band=zoneBand(row);
 return band?`<span class="bp-zone-tag bp-zone-${band.toLowerCase()}">Zone ${band}</span>`:'<span class="muted">Outside the bands</span>';
}
function chartTheme(){
 const style=getComputedStyle(document.documentElement);
 return Object.fromEntries(['ink','grid','axis','blue','teal'].map(key=>[key,style.getPropertyValue('--chart-'+key).trim()]));
}
function drawChart(id,config,theme){
 const {plugins={},scales={},...options}=config.options;
 const {legend={},...otherPlugins}=plugins;
 const axes=config.type==='doughnut'?{}:{x:{},y:{},...scales};
 const canvas=$(id);
 const panel=canvas.closest('.chart-panel');
 canvas.setAttribute('role','img');
 canvas.setAttribute('aria-label',`${panel.querySelector('h3').textContent}. ${panel.querySelector('p').textContent}`);
 canvas.hidden=false;
 canvas.parentElement.querySelector('.bp-chart-data-fallback')?.remove();
 charts.push(new Chart(canvas,{...config,options:{
  ...options,color:theme.ink,
  plugins:{...otherPlugins,legend:{...legend,labels:{...legend.labels,color:theme.ink}}},
  scales:Object.fromEntries(Object.entries(axes).map(([id,axis])=>[id,{
   ...axis,ticks:{...axis.ticks,color:theme.ink},title:{...axis.title,color:theme.ink},
   grid:{...axis.grid,color:theme.grid},border:{...axis.border,color:theme.axis}
  }]))
 }}));
}
function showChartFallback(panel,items){
 const box=panel.querySelector('.chart-box');
 const canvas=box.querySelector('canvas');
 if(canvas)canvas.hidden=true;
 box.querySelector('.bp-chart-data-fallback')?.remove();
 const text=document.createElement('p');
 text.className='bp-chart-data-fallback';
 text.textContent=items.join(' · ')||'No warehouse records for this chart';
 box.append(text);
}
function renderStudentCharts(){
 const rows=enriched(),theme=chartTheme();
 const style=getComputedStyle(document.documentElement);
 const colors=Object.fromEntries(['A','B','C'].map(key=>[key,style.getPropertyValue('--zone-'+key.toLowerCase()).trim()]));
 const by=key=>Object.entries(Object.groupBy(rows,key));
 const bands=by(row=>zoneBand(row)||'Outside the bands').sort(([a],[b])=>a.localeCompare(b));
 const zoneLabels=bands.map(([key])=>key.length===1?'Zone '+key:key);
 const zoneColors=bands.map(([key])=>colors[key]||theme.axis);
 const average=(group,key)=>{
  const values=group.map(row=>row[key]).filter(Number.isFinite);
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 };
 const series=(label,data,color)=>({label,data,backgroundColor:color,borderRadius:4});
 const panel=(id,title,description,{labels=[],datasets=[],type='bar',scales=null,
  extra={},plugins=[],legend=[],fallback=null,empty='No data for these dates.'}={})=>{
  const canvas=$(id),parent=canvas.closest('.chart-panel');
  parent.hidden=false;
  parent.querySelector('h3').textContent=title;
  parent.querySelector('p').textContent=description;
  parent.querySelector('.bp-chart-legend')?.remove();
  const usable=value=>Array.isArray(value)?value.every(Number.isFinite):Number.isFinite(value);
  const hasData=labels.length&&datasets.some(data=>data.data.some(usable));
  if(!hasData||typeof Chart==='undefined'){
   showChartFallback(parent,fallback||(hasData?labels.map((label,index)=>label+': '+datasets.map(ds=>{
    const value=ds.data[index];
    return ds.label+' '+(Array.isArray(value)?value.map(v=>numberText(v)).join('–'):numberText(value));
   }).join(', ')):[empty]));
  }else{
   const tooltip={padding:10,displayColors:type==='doughnut',backgroundColor:style.getPropertyValue('--paper').trim(),
    titleColor:theme.ink,bodyColor:theme.ink,borderColor:theme.grid,borderWidth:1,callbacks:{
     label:({dataset,raw,label})=>{
      if(type==='doughnut')return `${label}: ${raw} restaurants (${(100*raw/rows.length).toFixed(1)}%)`;
      const text=Array.isArray(raw)?raw.map(n=>numberText(n)).join('–'):numberText(raw,Number.isInteger(raw)?0:1);
      return `${dataset.label}: ${text}`;
     }
    }};
   drawChart(id,{type,plugins,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,
     animation:false,indexAxis:'y',...extra,
     plugins:{legend:{display:false},tooltip},scales:scales||{x:{beginAtZero:true}}}},theme);
  }
  if(legend.length){
   const list=document.createElement('ul');
   list.className='bp-chart-legend';
   for(const [key,label] of legend){
    const item=document.createElement('li'),dot=document.createElement('span');
    dot.className='bp-zone-swatch'+(colors[key]?' bp-zone-'+key.toLowerCase():'');
    dot.setAttribute('aria-hidden','true');item.append(dot,label);list.append(item);
   }
   parent.append(list);
  }
 };
 const eta=bands.map(([,r])=>currentModel?[average(r,'etaLow'),average(r,'etaHigh')]:
  studentPeriod.snapshot?average(r,'eta'):null);
 panel('zone-chart','Estimated delivery time by zone',
  currentModel?'Each bar spans the faster and slower estimates.':'Earlier dates may show one estimate per zone.',
  {labels:zoneLabels,datasets:[series('Estimated minutes',eta,zoneColors)],empty:'No delivery estimates for these dates.',
   scales:{x:{beginAtZero:true,title:{display:true,text:'Minutes'}}}});
 panel('student-stress-chart','Delivery travel difficulty by zone','See which areas need more estimated travel time.',
  {labels:zoneLabels,datasets:[series('Travel difficulty',bands.map(([,r])=>average(r,'transitStress')),zoneColors)],
   scales:{x:{min:0,max:100,title:{display:true,text:'Score out of 100'}}},empty:'Travel difficulty is unavailable for these dates.'});
 const total=rows.length,counts=bands.map(([,r])=>r.length);
 const legend=bands.map(([key,list],i)=>[key,`${zoneLabels[i]} · ${list.length} (${(list.length*100/total).toFixed(1)}%)`]);
 const center={id:'blueplate-zone-total',afterDraw(chart){
  const arc=chart.getDatasetMeta(0).data[0];if(!arc)return;
  const ctx=chart.ctx;ctx.save();
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=theme.ink;
  ctx.font='700 24px system-ui';ctx.fillText(String(total),arc.x,arc.y-7);
  ctx.font='12px system-ui';ctx.fillText('restaurants',arc.x,arc.y+14);ctx.restore();
 }};
 panel('student-zone-count-chart','Restaurants by zone','See where the restaurants in this view are located.',
  {type:'doughnut',labels:zoneLabels,datasets:[{data:counts,backgroundColor:zoneColors,borderWidth:2,
   borderColor:style.getPropertyValue('--paper').trim()}],plugins:[center],extra:{cutout:'68%'},
   legend,fallback:total?[`${total} restaurants`]:null});
 const cuisines=by(row=>row.cuisine||'Unclassified').sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
 const top=cuisines.slice(0,8).map(([name,list])=>[name,list.length]);
 if(cuisines.length>8)top.push(['Other cuisines',cuisines.slice(8).reduce((n,[,list])=>n+list.length,0)]);
 panel('cuisine-chart','Restaurant types and cuisines','Explore the types of food listed near UST.',
  {labels:top.map(([name])=>name.replaceAll('_',' ').split(';').map(word=>word.trim().replace(/^./,letter=>letter.toUpperCase())).join(' · ')),datasets:[series('Restaurants',top.map(([,n])=>n),theme.teal)],
   scales:{x:{beginAtZero:true,ticks:{precision:0}},y:{ticks:{autoSkip:false,callback:function(value){
    return this.getLabelForValue(value).match(/.{1,24}(?:\s|$)|\S{25,}/g)?.map(piece=>piece.trim())||this.getLabelForValue(value);
   }}}}});
 renderStudentExperiences();
 const demand=bands.map(([,group])=>currentModel?group.reduce((n,row)=>n+row.orderCount,0):null);
 const orderFormat=new Intl.NumberFormat('en-PH');
 const wholeShares=currentModel?roundDemandShares(demand,currentModel.demand_scenarios.pool[demandScenario]):[];
 panel('trend-chart','Order demand simulation','Hypothetical daily orders are shared equally across restaurants. These are neither actual orders nor demand forecasts.',
  {labels:['Assumed daily orders'],datasets:zoneLabels.map((label,i)=>series(label,[demand[i]],zoneColors[i])),
   scales:{x:{stacked:true,beginAtZero:true,title:{display:true,text:'Hypothetical orders per day'}},y:{stacked:true}},
   legend:currentModel?bands.map(([band],i)=>[band,`${zoneLabels[i]} · ${orderFormat.format(wholeShares[i])}`]):[],
   empty:'The order simulation is unavailable for these dates.'});
}
// Use the largest remainders, with zone order breaking ties, for display only.
function roundDemandShares(shares,pool){
 const whole=shares.map(Math.floor);
 const remainder=pool-whole.reduce((sum,value)=>sum+value,0);
 const ranked=shares.map((value,index)=>[index,value-whole[index]])
  .sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
 for(const [index] of ranked.slice(0,remainder))whole[index]++;
 return whole;
}
function renderStudentExperiences(){
 const totals=studentPeriod.report_totals;
 const ratings=Number(totals.report_rating_count||0);
 const deliveries=Number(totals.completed_delivery_count||0);
 const score=liveNumber(totals.auditor_avg_rating);
 const minutes=liveNumber(totals.observed_delivery_mins);
 const item=(id,title,value,sample,stars='')=>{
  $(id).innerHTML=`<h4>${title}</h4><strong>${value}</strong>${stars}<p>${sample}</p>`;
 };
 const stars=ratings&&score!==null?`<span class="bp-rating-stars" aria-hidden="true">★★★★★<span style="width:${Math.max(0,Math.min(100,score*20))}%">★★★★★</span></span>`:'';
 item('student-rating-chart','Student ratings',ratings&&score!==null?numberText(score)+' / 5':'Not enough data',
  ratings?sampleLabel(ratings,'rating'):'No eligible ratings for these dates.',stars);
 item('student-delivery-chart','Reported delivery time',deliveries&&minutes!==null?numberText(minutes)+' min':'Not enough data',
  deliveries?sampleLabel(deliveries,'completed delivery','completed deliveries'):'No completed delivery times for these dates.');
}
function zoneBand(row){
 const distance=liveNumber(row.distance);
 return row.zone?.match(/^Zone ([ABC]) —/)?.[1]||
  (distance===null?null:distance<=.5?'A':distance<=1?'B':distance<=1.5?'C':null);
}
function renderScenarioCharts(){
 const grouped=Object.groupBy(state.restaurants,row=>row.zone.charAt(5));
 const zones=Object.entries(grouped).sort(([a],[b])=>a.localeCompare(b)).map(([zone,rows])=>{
  const mean=key=>rows.reduce((total,r)=>total+r[key],0)/rows.length;
  const sum=key=>rows.reduce((total,r)=>total+r.demand[key],0);
  return [zone,{eta_low_min:{mean:mean('etaLow')},eta_high_min:{mean:mean('etaHigh')},
   transit_stress_points:{mean:mean('transitStress')},hypothetical_pool_share:{[demandScenario]:sum(demandScenario)}}];
 });
 const cuisines=Object.entries(Object.groupBy(state.restaurants,row=>row.cuisine)).map(([label,rows])=>[label,rows.length]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 const top=cuisines.slice(0,8);
 if(cuisines.length>8)top.push(['Other cuisines',cuisines.slice(8).reduce((n,x)=>n+x[1],0)]);
 const theme=chartTheme(), labels=zones.map(([zone])=>'Zone '+zone);
 const series=(label,data,color,yAxisID)=>({label,data,backgroundColor:color,yAxisID,borderRadius:4});
 const common={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}};
 const panels=[
  ['zone-chart','Delivery and transit stress by zone','Mean ETA endpoints and mean Transit Stress Index.',['minutes','points'],labels,[
   series('Fast ETA (min)',zones.map(([,z])=>z.eta_low_min.mean),theme.blue,'y'),
   series('Slow ETA (min)',zones.map(([,z])=>z.eta_high_min.mean),theme.teal,'y'),
   series('Transit stress (points)',zones.map(([,z])=>z.transit_stress_points.mean),theme.ink,'y1')]],
  ['trend-chart','Hypothetical demand by zone','One scenario snapshot. Zone shares reflect venue counts.',['Hypothetical orders/day'],labels,[
   series('Hypothetical orders/day',zones.map(([,z])=>z.hypothetical_pool_share[demandScenario]),theme.blue,'y')]],
  ['cuisine-chart','Restaurant coverage by cuisine','Counts use OSM cuisine tags.',['Venues'],top.map(([label])=>label),[
   series('Venues',top.map(([,count])=>count),theme.teal,'y')]],
 ];
 for(const [id,title,description,units,keys,datasets] of panels){
  const panel=$(id).closest('.chart-panel');
  panel.querySelector('h3').textContent=title;panel.querySelector('p').textContent=description;
  if(typeof Chart==='undefined'){
   showChartFallback(panel,keys.map((key,i)=>key+': '+datasets.map(set=>set.label+' '+numberText(set.data[i])).join(', ')));
   continue;
  }
  const axes={y:{beginAtZero:true,title:{display:true,text:units[0]}}};
  if(units.length===2)axes.y1={beginAtZero:true,position:'right',grid:{drawOnChartArea:false},title:{display:true,text:units[1]}};
  drawChart(id,{type:'bar',data:{labels:keys,datasets},options:{...common,scales:axes}},theme);
 }
}
function renderCharts(){
 if(liveMode && syntheticDemo){ renderSyntheticCharts(); return; }
 charts.forEach(c=>c.destroy());charts=[];
 if(typeof studentPeriod!=='undefined'&&studentPeriod){renderStudentCharts();return;}
 if(currentModel){renderScenarioCharts();return;}
 if(liveMode){
  // Keep the existing chart panels; show what MySQL actually provides even
  // when there are no historical ratings or only one dated trend record.
  const rows=enriched();
  const grouped=key=>{
   const m=new Map();for(const r of rows){const label=String(r[key]||'Unclassified');m.set(label,(m.get(label)||0)+1);}
   return [...m.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  };
  const zones=grouped('zone');
  const cuisines=grouped('cuisine');
  const metrics=[
   ['Address recorded',rows.filter(r=>String(r.streetAddress||'').trim()).length],
   ['Modeled ETA available',rows.filter(r=>Number.isFinite(r.eta)).length],
   ['Modeled risk available',rows.filter(r=>Number.isFinite(r.cancellationProxyPct)).length],
   ['Warehouse rating available',rows.filter(r=>Number.isFinite(r.publicRating)).length],
   ['Self-reported rating available',rows.filter(r=>Number.isFinite(r.selfReportedRating)).length]
  ];
  const zonePanel=$('zone-chart').closest('.chart-panel');
  const trendPanel=$('trend-chart').closest('.chart-panel');
  const cuisinePanel=$('cuisine-chart').closest('.chart-panel');
  zonePanel.querySelector('h3').textContent='Restaurants by UST zone';
  zonePanel.querySelector('p').textContent='Current active-directory counts, not modeled delivery estimates';
  cuisinePanel.querySelector('h3').textContent='Restaurants by cuisine';
  cuisinePanel.querySelector('p').textContent='Current restaurant counts by warehouse classification';
  const dated=liveTrend.filter(d=>/^\d{4}-\d\d-\d\d$/.test(d.date));
  const showTrend=dated.some(d=>Number.isFinite(d.orders)||Number.isFinite(d.eta));
  trendPanel.querySelector('h3').textContent=showTrend?(dated.length===1?'Modeled warehouse snapshot':'Available delivery history'):'Warehouse data coverage';
  trendPanel.querySelector('p').textContent=showTrend?
   dated.length===1?`${dated[0].date} · one modeled warehouse date`:`${dated.length} recorded dates in selected period · modeled, not actual orders`:
   'No dated demand or delivery estimates for the selected period. The chart shows directory and metric coverage.';
  const common={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}};
  if(typeof Chart==='undefined'){
   const fallbacks=[
    [zonePanel,zones],
    [trendPanel,showTrend?dated.map(d=>[d.date,`Modeled demand: ${d.orders??'Unavailable'}; modeled ETA: ${d.eta??'Unavailable'}`]):metrics],
    [cuisinePanel,cuisines]
   ];
   for(const [panel,items] of fallbacks)showChartFallback(panel,items.map(([k,v])=>`${k}: ${v}`));
   return;
  }
  const theme=chartTheme();
  const countAxis={beginAtZero:true,ticks:{precision:0},title:{display:true,text:'Restaurants'}};
  const categories={ticks:{autoSkip:false,callback:function(value){
   const label=this.getLabelForValue(value);
   return label.length>20?label.match(/.{1,20}(?:\s|$)|\S{21,}/g)?.map(part=>part.trim())||label:label;
  }}};
  const countChart=(id,items,color,x=countAxis)=>drawChart(id,{
   type:'bar',data:{labels:items.map(([label])=>label),datasets:[{label:'Restaurants',data:items.map(([,count])=>count),backgroundColor:color,borderRadius:5}]},
   options:{...common,indexAxis:'y',scales:{x,y:categories}}
  },theme);
  countChart('zone-chart',zones.map(([label,count])=>[label.replace('UST - ',''),count]),theme.blue);
  if(showTrend){
   const one=dated.length===1;
   const datasets=[
    {label:'Modeled demand',data:dated.map(x=>x.orders),borderColor:theme.blue,backgroundColor:theme.blue},
    {label:'Modeled delivery (min)',data:dated.map(x=>x.eta),borderColor:theme.teal,backgroundColor:theme.teal}
   ].filter(series=>series.data.some(Number.isFinite));
   const axes={x:{title:{display:true,text:'Warehouse date (MM-DD)'}}};
   datasets.forEach((series,index)=>{
    series.yAxisID=index?'y1':'y';
    series.tension=.25;
    series.pointRadius=one?0:4;
    axes[series.yAxisID]={beginAtZero:true,position:index?'right':'left',grid:{drawOnChartArea:index===0},
     title:{display:true,text:series.label==='Modeled demand'?'Estimated orders':'Minutes'}};
   });
   drawChart('trend-chart',{type:one?'bar':'line',data:{labels:dated.map(x=>x.date.slice(5)),datasets},
    options:{...common,plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:12}}},scales:axes}},theme);
  }else{
   countChart('trend-chart',metrics,theme.teal,{...countAxis,max:Math.max(1,rows.length)});
  }
  const top=cuisines.slice(0,9);
  if(cuisines.length>9)top.push(['Other cuisines',cuisines.slice(9).reduce((n,x)=>n+x[1],0)]);
  countChart('cuisine-chart',top,theme.blue);
  return;
 }
 if(typeof Chart==='undefined'){
  for(const id of ['zone-chart','trend-chart','cuisine-chart']){const box=$(id).parentElement;if(!box.querySelector('.chart-fallback')){const el=document.createElement('p');el.className='chart-fallback small muted';el.textContent='Charts need an internet connection to load Chart.js.';box.append(el);}}
  return;
 }
 const theme=chartTheme();Chart.defaults.color=theme.ink;Chart.defaults.borderColor=theme.grid;
 const all=enriched(),zones=['UST - España Blvd','UST - Dapitan St','UST - P. Noval St','UST - Lacson Ave'],labels=['España','Dapitan','P. Noval','Lacson'];
 const grouped=zones.map(z=>all.filter(r=>r.zone===z));const average=(g,key)=>g.length?g.reduce((a,x)=>a+x[key],0)/g.length:0;
 const common={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:11}}}};
 charts.push(new Chart($('zone-chart'),{type:'bar',data:{labels,datasets:[{label:'Modeled ETA (min)',data:grouped.map(g=>Number(average(g,'eta').toFixed(1))),backgroundColor:'#3772e9',borderRadius:4,yAxisID:'y'},{label:'Modeled risk (%)',data:grouped.map(g=>Number(average(g,'cancellationProxyPct').toFixed(1))),backgroundColor:'#13a39a',borderRadius:4,yAxisID:'y1'}]},options:{...common,scales:{y:{beginAtZero:true,title:{display:true,text:'Minutes'}},y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'Index %'}}}}}));
 const history=periodDailySummary();const rollup=history.length>31?7:history.length>14?3:1;
 const trend=[];
 for(let i=0;i<history.length;i+=rollup){const g=history.slice(i,i+rollup);trend.push({label:g[0].date.slice(5),orders:g.reduce((a,x)=>a+x.orders,0),eta:g.reduce((a,x)=>a+x.eta,0)/g.length});}
 charts.push(new Chart($('trend-chart'),{type:'line',data:{labels:trend.map(v=>v.label),datasets:[{label:'Modeled orders',data:trend.map(v=>v.orders),borderColor:'#3772e9',backgroundColor:'#3772e91b',fill:true,tension:.25,yAxisID:'y'},{label:'Modeled ETA (min)',data:trend.map(v=>Number(v.eta.toFixed(1))),borderColor:'#13a39a',tension:.3,yAxisID:'y1'}]},options:{...common,scales:{y:{beginAtZero:true,title:{display:true,text:'Orders per interval'}},y1:{position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'Minutes'}}}}}));
 const cuisines=[...new Set(all.map(r=>r.cuisine))];
 charts.push(new Chart($('cuisine-chart'),{type:'bar',data:{labels:cuisines,datasets:[{label:'Modeled rating',data:cuisines.map(c=>Number(average(all.filter(r=>r.cuisine===c),'blendedRating').toFixed(2))),backgroundColor:'#3772e9',borderRadius:4}]},options:{...common,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{min:0,max:5}}}}));
}
function renderSyntheticCharts(){
 const rows=enriched(); const zoneMap=new Map(),cuisineMap=new Map();
 for(const r of rows){
  const z=zoneMap.get(r.zone)||{count:0,eta:0,risk:0};z.count++;z.eta+=r.eta;z.risk+=r.cancellationProxyPct;zoneMap.set(r.zone,z);
  const c=cuisineMap.get(r.cuisine)||{count:0,rating:0};c.count++;c.rating+=r.blendedRating;cuisineMap.set(r.cuisine,c);
 }
 const zones=[...zoneMap.entries()].sort((a,b)=>b[1].count-a[1].count);
 const cuisines=[...cuisineMap.entries()].sort((a,b)=>b[1].count-a[1].count).slice(0,12);
 const dated=liveTrend.filter(d=>/^\d{4}-\d\d-\d\d$/.test(d.date));
 const panels=['zone-chart','trend-chart','cuisine-chart'].map(id=>$(id).closest('.chart-panel'));
 panels[0].querySelector('h3').textContent='SYNTHETIC delivery and risk by zone';
 panels[0].querySelector('p').textContent='Illustrative simulation, not observed delivery performance';
 panels[1].querySelector('h3').textContent='SYNTHETIC daily delivery trend';
 panels[1].querySelector('p').textContent='Synthetic demand and ETA for chosen reporting period';
 panels[2].querySelector('h3').textContent='SYNTHETIC ratings by cuisine';
 panels[2].querySelector('p').textContent='Fabricated scores for demonstration; not customer reviews';
 charts.forEach(c=>c.destroy());charts=[];
 if(typeof Chart==='undefined'){
  const fallback=[zones.map(([k,v])=>[k,+(v.eta/v.count).toFixed(1)]),dated.map(v=>[v.date,v.orders]),cuisines.map(([k,v])=>[k,+(v.rating/v.count).toFixed(2)])];
  panels.forEach((panel,i)=>showChartFallback(panel,fallback[i].map(([k,v])=>`${k}: ${v}`)));return;
 }
 const theme=chartTheme();Chart.defaults.color=theme.ink;Chart.defaults.borderColor=theme.grid;
 const common={responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}};
 charts.push(new Chart($('zone-chart'),{type:'bar',data:{labels:zones.map(([z])=>z.replace('UST - ','')),datasets:[
  {label:'Synthetic ETA (min)',data:zones.map(([_,v])=>+(v.eta/v.count).toFixed(1)),backgroundColor:'#3772e9',yAxisID:'y'},
  {label:'Synthetic risk index (%)',data:zones.map(([_,v])=>+(v.risk/v.count).toFixed(1)),backgroundColor:'#13a39a',yAxisID:'y1'}]},options:{...common,scales:{y:{beginAtZero:true},y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false}}}}}));
 charts.push(new Chart($('trend-chart'),{type:dated.length===1?'bar':'line',data:{labels:dated.map(d=>d.date.slice(5)),datasets:[
  {label:'Synthetic demand',data:dated.map(d=>d.orders),borderColor:'#3772e9',backgroundColor:'#3772e9',yAxisID:'y'},
  {label:'Synthetic ETA (min)',data:dated.map(d=>d.eta),borderColor:'#13a39a',backgroundColor:'#13a39a',yAxisID:'y1'}]},options:{...common,scales:{y:{beginAtZero:true},y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false}}}}}));
 charts.push(new Chart($('cuisine-chart'),{type:'bar',data:{labels:cuisines.map(([c])=>c),datasets:[
  {label:'Synthetic rating / 5',data:cuisines.map(([_,v])=>+(v.rating/v.count).toFixed(2)),backgroundColor:'#3772e9'}]},options:{...common,indexAxis:'y',scales:{x:{min:0,max:5},y:{}}}}));
}
function refreshCharts(){if(page==='admin'&&$('zone-chart')&&!(liveRequired&&liveError))renderCharts();}


// ----- BluePlate v6: dated illustrative history and shared date controls -----
// The reference dataset has no dated transactions. We synthesize 90 days of
// clearly-labeled deterministic demo observations, never present them as real facts.
function localDay(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function fromDay(day){const [y,m,d]=day.split('-').map(Number);return new Date(y,m-1,d);}
function shiftDay(date,delta){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());d.setDate(d.getDate()+delta);return d;}
function reportingToday(){
 if(!liveMode||syntheticDemo)return new Date();
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date());
 const day=Object.fromEntries(parts.map(({type,value})=>[type,value]));
 return fromDay(`${day.year}-${day.month}-${day.day}`);
}
function dateLimits(){
 const today=shiftDay(reportingToday(),0), min=localDay(shiftDay(today,-89));
 const earliest=typeof warehouseFreshness==='undefined'?null:warehouseFreshness?.analytical_dates?.at(-1)?.report_date;
 return {oldest:earliest&&earliest<min?earliest:min,today:localDay(today)};
}
function currentRange(){
 if(periodPreset==='latest')return {from:latestReportingDate,to:latestReportingDate};
 if(periodPreset==='latest-report')return {from:latestReportSubmissionDate,to:latestReportSubmissionDate};
 const today=shiftDay(reportingToday(),0),last=localDay(today);
 if(periodPreset==='custom'&&customFrom&&customTo)return {from:customFrom,to:customTo};
 const days=periodPreset==='90d'?90:periodPreset==='30d'?30:7;
 return {from:localDay(shiftDay(today,-days+1)),to:last};
}
function inPeriod(day){if(!day)return false;const w=currentRange();return day>=w.from&&day<=w.to;}
function dateRangeLabel(){const w=currentRange();return periodPreset==='latest'||periodPreset==='latest-report'?w.to:periodPreset==='7d'?'Last 7 days':periodPreset==='30d'?'Last 30 days':periodPreset==='90d'?'Last 90 days':`${w.from} to ${w.to}`;}
function formatDateTime(value){const d=new Date(value);return Number.isNaN(d.getTime())?'Unknown date':d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',...(liveMode&&!syntheticDemo?{timeZone:'Asia/Manila'}:{})});}
function visibleGuestReports(){return safeRead(REPORT_KEY).filter(r=>r.createdAt&&!Number.isNaN(new Date(r.createdAt).getTime())&&inPeriod(localDay(new Date(r.createdAt))));}
function initModeledHistory(){
 if(liveMode)return; // Never regenerate synthetic history over warehouse records.
 const today=shiftDay(new Date(),0);
 for(const r of state.restaurants){
  const rows=[];
  for(let i=89;i>=0;i--){
   const day=shiftDay(today,-i),serial=89-i;
   const s=Math.sin((serial+r.id*2.4)*.27),w=Math.cos((serial+r.id*3.6)*.11),weekday=day.getDay();
   const eta=Math.max(12,r.proxyDeliveryMins+1.7*s+1.1*w+(weekday===5?1.3:0));
   const risk=Math.max(.5,r.cancellationProxyPct+1.0*Math.sin((serial+r.id)*.18)+.5*w);
   const rating=Math.max(2.7,Math.min(5,r.publicRating-.12+Math.sin((serial+r.id)*.16)*.16));
   const orders=Math.max(3,Math.round(18+r.id*2.5+(weekday===0?-4:weekday===5?7:3)+s*3.3+w*2.1));
   rows.push({date:localDay(day),eta:Number(eta.toFixed(2)),risk:Number(risk.toFixed(2)),rating:Number(rating.toFixed(3)),orders});
  }
  modeledHistory.set(r.id,rows);
 }
}
function historyFor(id){return (modeledHistory.get(id)||[]).filter(row=>inPeriod(row.date));}
function periodDailySummary(){
 if(liveMode)return liveTrend.map(x=>({date:x.date,eta:x.eta,orders:x.orders}));
 const map=new Map();
 for(const rows of modeledHistory.values())for(const r of rows){if(!inPeriod(r.date))continue;const v=map.get(r.date)||{date:r.date,eta:0,orders:0,n:0};v.eta+=r.eta;v.orders+=r.orders;v.n++;map.set(r.date,v);}
 return Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date)).map(v=>({...v,eta:v.eta/v.n}));
}
function syncPeriodButtons(){
 const selected=customPeriodDraft?'custom':periodPreset;
 document.querySelectorAll('[data-period]').forEach(btn=>{const active=btn.dataset.period===selected;btn.classList.toggle('is-active',active);btn.setAttribute('aria-pressed',String(active));});
}
function renderPeriodCaption(){
 const caption=$('bp-period-caption');
 if(!caption)return;
 const freshness=$('bp-view-freshness');
 if(typeof studentMode!=='undefined'&&studentMode){
  freshness.hidden=false;
  renderFreshnessValues();
  if(customPeriodDraft){caption.textContent='Choose a start and end date, then select Apply dates.';return;}
  const range=studentPeriod?.period;
  const label=range?(range.from===range.to?prettyManila(range.from):prettyManila(range.from)+' – '+prettyManila(range.to)):'Latest available · all student reports to date';
  const date=studentPeriod?.snapshot?.report_date;
  caption.textContent='Selected reporting period: '+label+(date?' · Estimates from '+prettyManila(date):studentPeriod?' · No estimates for these dates.':'');
  return;
 }
 if(currentModel&&(periodPreset==='current'||selectedScenarioDate())){
  freshness.hidden=false;
  renderFreshnessValues();
  caption.textContent=`${currentModel.version} · ${currentModel.snapshot_date_manila} (Manila)`;
  return;
 }
 freshness.hidden=!liveMode||syntheticDemo;
 if(syntheticDemo){
  caption.textContent=customPeriodDraft?'Choose both dates, then click Apply dates.':`${dateRangeLabel()} · SYNTHETIC DEMONSTRATION · real OSM venues, fabricated performance data.`;
  return;
 }
 const {from,to}=currentRange();
 const range=from===to?to:`${from} to ${to}`;
 const context=periodPreset==='latest'?'Modeled warehouse snapshot':periodPreset==='latest-report'?'Student-reported feedback':'Selected reporting period';
 const selected=customPeriodDraft?'Choose both dates, then select Apply dates.':`${context} · ${range}`;
 const empty=!customPeriodDraft&&liveHasObservations===false?'\nNo warehouse estimates or student reports for this period.':'';
 caption.textContent=`${selected}${empty}`;
 renderFreshnessValues();
}
function prettyManila(value){
 if(!value)return 'Not available';
 const dated=value.length===10;
 const date=new Date(dated?value+'T00:00:00+08:00':value+'+08:00');
 if(!Number.isFinite(date.valueOf()))return 'Not available';
 return new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',...(dated?{}:{timeStyle:'short'}),timeZone:'Asia/Manila'}).format(date);
}
function renderFreshnessValues(){
 const display=value=>value?value.replace('T',' '):'Not available';
 if(typeof studentMode!=='undefined'&&studentMode){
  $('bp-warehouse-date').textContent=prettyManila(warehouseFreshness?.warehouse_as_of);
  $('bp-latest-guest-date').textContent=warehouseFreshness?.latest_genuine_report?prettyManila(warehouseFreshness.latest_genuine_report)+' Manila':'No student reports yet';
  $('bp-directory-date').textContent=prettyManila(warehouseFreshness?.directory_updated_at);
  $('bp-dashboard-loaded-at').textContent=dashboardLoadedAt?.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'})||'Not available';
  const dates=dateLimits();
  $('bp-custom-from').min=$('bp-custom-to').min=dates.oldest;
  return;
 }

 $('bp-warehouse-date').textContent=warehouseFreshness?.warehouse_as_of||latestReportingDate||'Not available';
 $('bp-latest-guest-date').textContent=warehouseFreshness
  ?(warehouseFreshness.latest_genuine_report?display(warehouseFreshness.latest_genuine_report):'No guest reports yet')
  :(latestGuestReportDate||(latestGuestReportDate===null?'No guest reports yet':'Not available'));
 $('bp-directory-date').textContent=display(warehouseFreshness?.directory_updated_at);
 $('bp-dashboard-loaded-at').textContent=dashboardLoadedAt?.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})||'Not available';
}

function selectedScenarioDate(){
 if(periodPreset!=='custom'||customFrom!==customTo||customPeriodDraft)return null;
 return warehouseFreshness?.analytical_dates?.some(row=>row.metric_family==='DELIVERY_SCENARIO'&&row.report_date===customFrom)?customFrom:null;
}
function refreshSelectedPeriod(){
 customPeriodDraft=false;
 liveHasObservations=null;
 syncPeriodButtons();
 renderPeriodCaption();
 if(typeof studentMode!=='undefined'&&studentMode)return window.BluePlateBridge?.refreshAdmin(currentRange()).catch(()=>{});
 return (periodPreset==='current'||(currentModel&&!latestReportingDate)
  ?window.BluePlateBridge?.refreshDashboard()
  :window.BluePlateBridge?.refreshAdmin(currentRange()))?.catch(()=>{});
}
function updatePeriod(){
 if(liveMode){
  refreshSelectedPeriod();
  return;
 }
 renderAdmin();
 const dialog=$('bp-detail-dialog');if(dialog?.open)renderRestaurantDetail(Number(dialog.dataset.restaurantId));
 const caption=$('bp-period-caption');if(caption)caption.textContent=`${dateRangeLabel()} · Data simulated for UI testing from a rolling 90-day window. Only browser-submitted reports have real local timestamps.`;
 syncPeriodButtons();
}
function initPeriodToolbar(){
 const host=document.createElement('div');host.className='bp-period-toolbar';
 host.innerHTML=`<div class="bp-period-top"><h2 class="bp-feature-title">Reporting period</h2><div class="bp-period-tabs" role="group" aria-label="Reporting period"><button type="button" id="bp-available-period" class="hidden" data-period="available">Latest available</button><button type="button" id="bp-current-period" class="hidden" data-period="current">Current snapshot</button><button type="button" id="bp-latest-period" class="hidden" data-period="latest">Earlier warehouse snapshot</button><button type="button" id="bp-latest-report-period" class="hidden" data-period="latest-report">Latest report date</button><button type="button" data-period="7d">7 days</button><button type="button" data-period="30d">30 days</button><button type="button" data-period="90d">90 days</button><button type="button" data-period="custom">Custom</button></div><p id="bp-period-caption" class="bp-feature-description" role="status" aria-atomic="true"></p>
 <dl id="bp-view-freshness" class="bp-view-freshness" hidden>
  <div><dt>Data last updated</dt><dd id="bp-warehouse-date"></dd></div>
  <div><dt>Latest student report</dt><dd id="bp-latest-guest-date"></dd></div>
 </dl>
 <details class="bp-freshness-details"><summary>About these dates</summary>
  <p>The latest view uses the newest estimates and all student reports to date. A date range uses the newest set of estimates within those dates and reports submitted during the same range.</p>
  <dl><div><dt>Directory updated (Manila)</dt><dd id="bp-directory-date"></dd></div><div><dt>Page refreshed (Manila)</dt><dd id="bp-dashboard-loaded-at"></dd></div></dl>
 </details>
 <p class="bp-feature-description">Current and historical models use different methods. Student feedback describes voluntarily reported deliveries.</p></div><div id="bp-custom-dates" class="bp-custom-dates hidden"><label>From<input id="bp-custom-from" type="date" class="field" aria-label="Start date"></label><label>To<input id="bp-custom-to" type="date" class="field" aria-label="End date"></label><button type="button" id="bp-custom-apply" class="btn secondary">Apply dates</button></div>`;
 $('overview').querySelector('.page-heading').insertAdjacentElement('afterend',host);
 const limits=dateLimits(),from=$('bp-custom-from'),to=$('bp-custom-to');
 for(const input of [from,to]){input.min=limits.oldest;input.max=limits.today;}
 from.value=localDay(shiftDay(reportingToday(),-29));to.value=limits.today;
 customFrom=from.value;customTo=to.value;
 host.querySelectorAll('[data-period]').forEach(btn=>btn.onclick=()=>{
  manualPeriodSelected=true;
  const selected=btn.dataset.period;
  $('bp-custom-dates').classList.toggle('hidden',selected!=='custom');
  if(liveMode&&selected==='custom'){
   customPeriodDraft=true;
   syncPeriodButtons();
   renderPeriodCaption();
   return;
  }
  periodPreset=selected;
  if(liveMode&&selected==='latest'&&!latestReportingDate){manualPeriodSelected=false;window.BluePlateBridge?.refreshDashboard(true).catch(()=>{});return;}
  updatePeriod();
 });
 $('bp-custom-apply').onclick=()=>{
  const start=from.value,end=to.value;
  const limits=dateLimits();
  if(!start||!end||start>end||start<limits.oldest||end>limits.today){toast(`Choose valid dates between ${limits.oldest} and ${limits.today}.`);return;}
  manualPeriodSelected=true;customFrom=start;customTo=end;periodPreset='custom';updatePeriod();
 };
 updatePeriod();
}

// ----- Restaurant detail view -----
function initRestaurantDetails(){
 const dialog=document.createElement('dialog');dialog.id='bp-detail-dialog';dialog.className='bp-detail-dialog';
 dialog.innerHTML='<div class="bp-detail-content" id="bp-detail-content"></div>';
 document.body.append(dialog);
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 dialog.addEventListener('close',()=>{dialog.dataset.restaurantId='';});
 $('directory-rows').addEventListener('click',e=>{
  const button=e.target.closest('[data-restaurant-detail]');if(!button)return;
  const id=Number(button.dataset.restaurantDetail);
  dialog.dataset.restaurantId=String(id);renderRestaurantDetail(id);dialog.showModal();
 });
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-close-detail]'))dialog.close();});
}
function smallSparkline(data){
 if(!data.length)return '<p class="small muted">No modeled data for this period.</p>';
 const width=560,height=95,min=Math.min(...data),max=Math.max(...data),spread=Math.max(max-min,1);
 if(data.length===1)return `<p class="bp-feature-description">One warehouse snapshot: ${numberText(data[0])} min modeled delivery.</p>`;
 const points=data.map((x,i)=>`${(i/Math.max(1,data.length-1)*width).toFixed(1)},${(height-12-(x-min)/spread*(height-24)).toFixed(1)}`).join(' ');
 return `<svg class="bp-trend-sparkline" role="img" aria-label="Modeled daily delivery time trend, ${data.length} observations" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function renderRestaurantDetail(id){
 if(studentPeriod){
  const row=enriched().find(r=>r.id===id);if(!row)return;
  const source=publicVenueLabel(row)||'Historical restaurant listing';
  const classification=row.cuisineClassification;
  const eta=currentModel?`${numberText(row.etaLow)}–${numberText(row.etaHigh)} min`:Number.isFinite(row.eta)?numberText(row.eta)+' min':'Not available';
  const estimates=[['Estimated delivery',eta,currentModel?'Estimated range':'Estimate for the selected dates']];
  if(currentModel)estimates.push(['Travel difficulty',numberText(row.transitStress)+' / 100','Share of the assumed travel-time budget'],
   ['Simulated orders per day',numberText(row.orderCount,2),'Equal share of the selected scenario']);
  const reports=reportMetrics(row.genuineTotals||{}).map(([label,value,sub])=>[label.replace('Accepted reports','Student reports').replace('Self-reported','Student-reported'),value,sub]);
  const markup=items=>items.map(([label,value,sub])=>`<div><span>${html(label)}</span><strong>${html(value)}</strong><small>${html(sub)}</small></div>`).join('');
  $('bp-detail-content').innerHTML=`<div class="bp-detail-head"><div><h2 id="bp-dialog-title">${html(row.name)}</h2><p>${html(row.streetAddress||'Address unavailable')} · ${zoneTag(row)} · ${html(row.zone)}</p>
  <p>Cuisine or specialty: ${html(row.cuisine||'Not specified')}</p>
  ${classification?`<p>Establishment type: ${html(classification.establishment_type)}</p>
  ${classification.cuisines.length>1?`<p>Cuisines: ${html(classification.cuisines.join(', '))}</p>`:''}
  ${classification.specialties.length&&classification.specialties.join(', ')!==row.cuisine?`<p>Food specialties: ${html(classification.specialties.join(', '))}</p>`:''}
  ${classification.source!=='Not specified'?`<p>Classification source: ${html(classification.source)}</p>`:''}`:''}
  <p>Information source: ${html(source)}</p><p>Opening status: ${html(row.verificationProvenance==='USER_CONFIRMED'||row.verificationProvenance==='INDEPENDENTLY_VERIFIED'?'Confirmed open':'Not confirmed in this view')}</p>
  </div><button type="button" class="bp-detail-close" data-close-detail aria-label="Close restaurant details">×</button></div>
  <h3>Delivery estimates</h3><div class="bp-detail-metrics">${markup(estimates)}</div><h3>Student feedback</h3><div class="bp-detail-metrics">${markup(reports)}</div>
  <p class="bp-feature-description">Student reports describe individual experiences.</p>`;
  $('bp-detail-dialog').setAttribute('aria-labelledby','bp-dialog-title');
  return;
 }
 if(currentModel){
  const row=enriched().find(r=>r.id===id);if(!row)return;
  const reports=reportMetrics(row.genuineTotals);
  const items=[
   ['Modeled ETA range',`${numberText(row.etaLow)}–${numberText(row.etaHigh)} min`,'Scenario endpoints'],
   ['Transit Stress Index',numberText(row.transitStress)+' points','Modeled travel time only'],
   ['Hypothetical orders per day',numberText(row.orderCount,2),'Equal scenario allocation'],
   ...reports,
  ];
  $('bp-detail-content').innerHTML=`<div class="bp-detail-head"><div><h2 id="bp-dialog-title">${html(row.name)}</h2><p>${html(row.streetAddress||'Address unavailable')} · ${html(row.zone)} · ${html(publicVenueLabel(row))}</p></div><button type="button" class="bp-detail-close" data-close-detail aria-label="Close restaurant details">×</button></div>
   <div class="bp-detail-metrics">${items.map(([label,value,sub])=>`<div><span>${html(label)}</span><strong>${html(value)}</strong><small>${html(sub)}</small></div>`).join('')}</div><p class="bp-feature-description">${html(reportMethodology)}</p>`;
  $('bp-detail-dialog').setAttribute('aria-labelledby','bp-dialog-title');
  return;
 }
 if(liveMode && syntheticDemo){
  const r=enriched().find(x=>x.id===id);if(!r)return;
  $('bp-detail-content').innerHTML=`<div class="bp-detail-head"><div><div class="section-tag">SYNTHETIC DEMO · REAL OSM RESTAURANT IDENTITY</div><h2 id="bp-dialog-title">${html(r.name)}</h2><p>${html(r.branch)} · ${html(r.zone)}</p></div><button class="bp-detail-close" data-close-detail aria-label="Close details">×</button></div><div class="bp-detail-metrics"><div><span>Synthetic ETA</span><strong>${r.eta.toFixed(1)} min</strong></div><div><span>Synthetic risk</span><strong>${r.cancellationProxyPct.toFixed(1)}%</strong></div><div><span>Synthetic rating</span><strong>${r.blendedRating.toFixed(2)}/5</strong></div><div><span>Synthetic health</span>${badge(r.health)}</div></div><p class="bp-feature-description">Illustrative outputs only. No observed order, actual rating, or verified restaurant performance is implied.</p>`;
  $('bp-detail-dialog').setAttribute('aria-labelledby','bp-dialog-title');return;
 }
 if(liveMode){renderLiveRestaurantDetail(id);return;}
 const r=enriched().find(x=>x.id===id);if(!r)return;
 const all=enriched(),avg=key=>all.reduce((a,x)=>a+x[key],0)/all.length,history=historyFor(r.id);
 const guest=visibleGuestReports().filter(x=>Number(x.restaurantId)===r.id);
 const diff=r.eta-avg('eta'),sign=diff>0?'+':'';
 $('bp-detail-content').innerHTML=`<div class="bp-detail-head"><div><div class="section-tag">Restaurant performance · illustrative</div><h2 id="bp-dialog-title">${html(r.name)}</h2><p>${html(r.branch)} · ${html(r.cuisine)} · ${html(r.zone.replace('UST - ',''))}</p></div><button type="button" class="bp-detail-close" data-close-detail aria-label="Close restaurant details">×</button></div><div class="bp-detail-meta"><span>📍 ${html(r.nearestGate)}</span><span>Typical price ${html(r.priceRange)}</span><span>${html(dateRangeLabel())}</span></div><div class="bp-detail-metrics"><div><span>Delivery time</span><strong>${r.eta.toFixed(1)} min</strong><small>Modeled average</small></div><div><span>Risk index</span><strong>${r.cancellationProxyPct.toFixed(1)}%</strong><small>Modeled, not actual cancellations</small></div><div><span>Rating</span><strong>${r.blendedRating.toFixed(2)} ★</strong><small>Modeled / local reports</small></div><div><span>Health</span>${badge(r.health)}<small>Period threshold</small></div></div><div class="bp-detail-comparison"><strong>Compared with UST campus average</strong><p>Modeled delivery is <b>${Math.abs(diff).toFixed(1)} min ${diff>0?'slower':diff<0?'faster':'equal'}</b> (${sign}${diff.toFixed(1)} min difference). Campus mean: ${avg('eta').toFixed(1)} min.</p></div><div class="bp-detail-trend"><div class="bp-feature-title">Delivery trend</div><p class="bp-feature-description">Modeled daily ETA, not a live delivery feed</p>${smallSparkline(history.map(x=>x.eta))}</div><div class="bp-detail-foot"><div><strong>${history.reduce((a,x)=>a+x.orders,0).toLocaleString()}</strong><span>Illustrative orders in period</span></div><div><strong>${guest.length}</strong><span>Browser auditor reports in period</span></div></div>${guest.length?`<div class="bp-detail-report-list"><strong>Recent browser reports</strong>${guest.slice(0,3).map(x=>`<p>${html(formatDateTime(x.createdAt))} · ${x.cancelled?'Cancelled':`${Number(x.minutes)} min delivered`} · ${Number(x.rating)}/5 ★</p>`).join('')}</div>`:'<p class="bp-feature-description">No browser-submitted reports for this restaurant in the selected period.</p>'}`;
 const title=$('bp-dialog-title');if(title){$('bp-detail-dialog').setAttribute('aria-labelledby',title.id);}
}

async function renderLiveRestaurantDetail(id){
 const box=$('bp-detail-content');box.innerHTML='<p class="muted">Loading warehouse restaurant details…</p>';
 try{
  const result=await window.BluePlateBridge.restaurantDetail(id,currentRange());
  if($('bp-detail-dialog').dataset.restaurantId!==String(id))return;
  const d=result.restaurant||{};
  const dates=result.history||[];
  const observed=dates.filter(x=>liveNumber(x.proxy_delivery_mins)!==null);
  const v=(n,suffix='',places=1)=>liveNumber(n)===null?'Not available':`${numberText(liveNumber(n),places)}${suffix}`;
  const chart=smallSparkline(observed.map(x=>liveNumber(x.proxy_delivery_mins)));
  const zone=d.zone_name||'Unknown zone';
  const address=String(d.street_address||'').trim();
  const hasAddress=address&&!['address not recorded in osm','sampaloc, manila'].includes(address.toLowerCase());
  const reportCards=reportMetrics(d).map(([label,value,caption])=>
   `<div><span>${html(label)}</span><strong>${html(value)}</strong><small>${html(caption)}</small></div>`).join('');
  box.innerHTML=`
   <div class="bp-detail-head"><div><div class="section-tag">Restaurant performance</div>
    <h2 id="bp-dialog-title">${html(d.restaurant_name)}</h2>
    <p>${html(d.branch_label||(hasAddress?address:'Address not available'))} · ${html(d.cuisine_name||'Unclassified')} · ${html(zone)}</p></div>
    <button class="bp-detail-close" type="button" data-close-detail aria-label="Close details">×</button></div>
   <h3 class="bp-feature-title">Warehouse estimates</h3>
   <div class="bp-detail-metrics">
    <div><span>Modeled delivery</span><strong>${html(v(d.proxy_delivery_mins,' min'))}</strong><small>Estimated delivery time</small></div>
    <div><span>Modeled risk index</span><strong>${html(v(d.cancellation_risk_index,' points'))}</strong><small>Distance-based estimate</small></div>
    <div><span>Warehouse rating</span><strong>${html(v(d.warehouse_rating_days>0?d.public_avg_rating:null,' / 5',2))}</strong><small>${html(warehouseRatingLabel(d.warehouse_rating_days))}</small></div>
    <div><span>Warehouse dates</span><strong>${dates.length}</strong><small>Records in this period</small></div>
   </div>
   <div class="bp-detail-trend"><h3 class="bp-feature-title">Modeled delivery by date</h3>${chart}</div>
   <h3 class="bp-feature-title">Student delivery reports</h3>
   <div class="bp-detail-metrics">${reportCards}</div>
   <p class="bp-feature-description">${html(reportMethodology)}</p>`;
  $('bp-detail-dialog').setAttribute('aria-labelledby','bp-dialog-title');
 }catch(err){box.textContent=`Could not load warehouse details: ${err.message}`;}
}

// ----- Safe CSV export (Excel/Sheets-friendly UTF-8 with BOM) -----
function csvCell(v){
 let s=String(v??'');
 if(/^[\t\r\n\s]*[=+@-]/.test(s))s="'"+s; // Stop spreadsheet formula interpretation for text fields.
 return '"'+s.replace(/"/g,'""')+'"';
}
function writeCsv(filename,rows){
 const lines=rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
 const blob=new Blob(['\ufeff'+lines+'\r\n'],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportDirectoryCsv(){
 if(liveMode && !syntheticDemo){window.BluePlateBridge.downloadCsv('restaurants',currentRange());return;}
 const r=directoryRows();if(!r.length){toast('No restaurants match the current filters.');return;}
 const w=currentRange(),lines=[['Restaurant','Branch','Zone','Gate','Cuisine','Distance km','Average price PHP','Delivery ETA minutes (modeled)','Risk index percent (modeled)','Rating (modeled)','Health','Modeled order count','Browser reports count','From','To','Data source']];
 for(const v of r)lines.push([v.name,v.branch,v.zone,v.nearestGate,v.cuisine,v.distance,v.avgPricePhp,v.eta,v.cancellationProxyPct,v.blendedRating,v.health,v.orderCount,v.reportCount,w.from,w.to,'Illustrative demo model plus browser-local reports']);
 writeCsv(`blueplate_directory_${w.from}_to_${w.to}.csv`,lines);toast(`Exported ${r.length} filtered restaurant rows as CSV.`);
}
function exportReportsCsv(){
 if(liveMode && !syntheticDemo){window.BluePlateBridge.downloadCsv('reports',currentRange());return;}
 if(liveMode && syntheticDemo){
  const lines=[['Restaurant','Source','Date','Rating','Delivery minutes','Cancelled','Comment','Label']];
  for(const r of liveReports)lines.push([r.restaurant_name,r.submission_source,r.submitted_at,r.rating_score,r.actual_observed_delivery_mins,r.order_was_cancelled,r.comment_text,'SYNTHETIC DEMONSTRATION / BROWSER PRACTICE']);
  writeCsv('blueplate_SYNTHETIC_DEMO_reports.csv',lines);toast('Exported demo report samples. No MySQL rows were exported.');return;
 }
 const allowed=new Set(directoryRows().map(x=>x.id));const reports=visibleGuestReports().filter(r=>allowed.has(Number(r.restaurantId)));
 if(!reports.length){toast('No browser-submitted reports match this period and restaurant filters.');return;}
 const rows=[['Report ID','Timestamp local','Restaurant','Branch','Zone','Outcome','Delivery minutes','Rating','Notes','Source']];
 for(const r of reports){const v=state.restaurants.find(x=>x.id===Number(r.restaurantId));if(!v)continue;rows.push([r.id,formatDateTime(r.createdAt),v.name,v.branch,v.zone,r.cancelled?'Cancelled':'Delivered',r.cancelled?'':r.minutes,r.rating,r.notes,'Browser-local user submission']);}
 const w=currentRange();writeCsv(`blueplate_auditor_reports_${w.from}_to_${w.to}.csv`,rows);toast(`Exported ${reports.length} browser-submitted reports as CSV.`);
}
function initExportControls(){
 const head=$('restaurants').querySelector('.section-head');
 const tools=document.createElement('div');tools.className='bp-export-controls';
 tools.innerHTML='<button type="button" class="btn secondary" id="bp-export-directory">↓ Export restaurants</button>';
 if(!liveRequired)tools.insertAdjacentHTML('beforeend','<button type="button" class="btn secondary" id="bp-export-reports">↓ Export reports</button>');
 head.append(tools);
 $('bp-export-directory').onclick=exportDirectoryCsv;
 if(!liveRequired)$('bp-export-reports').onclick=exportReportsCsv;
}

// ----- Public submission confirmation -----
function initSubmissionConfirmation(){
 const panel=document.createElement('section');panel.id='bp-report-success';panel.className='bp-report-success hidden';panel.setAttribute('aria-live','polite');
 $('audit-form').insertAdjacentElement('afterend',panel);
}
function showSubmissionConfirmation(report,restaurant,stored){
 const card=$('bp-report-success');
 const liveReceipt=liveMode&&!syntheticDemo;
 const title=liveReceipt?(report.status==='replayed'?'Report already saved':'Report saved'):'Practice report added';
 const details=liveReceipt?
  `<p class="bp-success-sub">Report reference <strong>#${html(report.user_review_id)}</strong></p>${report.unlisted_restaurant?'<p>Your restaurant details will be reviewed separately.</p>':''}`:
  `<p class="bp-success-sub">${stored?'This practice report is saved in this browser.':'Browser storage was unavailable. This practice report is available for this session.'}</p>
   <dl><div><dt>Restaurant</dt><dd>${html(restaurant.name)}</dd></div><div><dt>Outcome</dt><dd class="${report.cancelled?'bp-result-cancelled':'bp-result-delivered'}">${report.cancelled?'Cancelled':'Delivered'}</dd></div><div><dt>Delivery time</dt><dd>${report.cancelled?'Not applicable':Number(report.minutes)+' min'}</dd></div><div><dt>Rating</dt><dd>${Number(report.rating)}/5 ★</dd></div><div><dt>Browser time</dt><dd>${html(formatDateTime(report.createdAt))}</dd></div></dl>`;
 card.innerHTML=`<div class="bp-success-icon" aria-hidden="true">✓</div><h3 tabindex="-1" id="bp-success-heading">${title}</h3>${details}
  <button type="button" class="submit-btn" id="bp-submit-another">Submit another report</button>
  <a class="bp-receipt-link" href="#recent">View recent student reports</a>`;
 $('audit-form').classList.add('hidden');card.classList.remove('hidden');
 $('bp-submit-another').onclick=()=>{card.classList.add('hidden');$('audit-form').classList.remove('hidden');$('audit-restaurant')._bpFocus?.();$('report-form-section').scrollIntoView({behavior:'smooth',block:'start'});};
 $('bp-success-heading').focus({preventScroll:true});$('report-form-section').scrollIntoView({behavior:'smooth',block:'start'});
}

// Explicit bridge interface: registered INSIDE the app closure (scope-safe).
function liveNotice(){
 const existing=$('bp-live-notice');
 if(existing)return existing;
 const notice=document.createElement('div');notice.id='bp-live-notice';notice.setAttribute('role','status');notice.className='bp-live-notice';
 (document.querySelector('main')||document.body).prepend(notice);
 return notice;
}
window.BluePlateApp={
 activateLive({guestEnabled=false,demoEnabled=false,unlistedEnabled=false}={}){
  liveMode=true;syntheticDemo=!!demoEnabled;liveGuestEnabled=!!guestEnabled && !syntheticDemo;liveError=liveRequired?'Connecting…':'';
  state.restaurants=[];state.alerts=[];liveReports=[];liveTrend=[];liveReportTotals={};modeledHistory.clear();
  document.querySelectorAll('.header-chip').forEach(el=>el.textContent=liveRequired?(page==='admin'?'Delivery dashboard':'Delivery reports'):(page==='admin'?'Delivery dashboard':'Delivery reports'));
  const notice=liveNotice();
  notice.textContent=liveRequired?'Loading dashboard data…':'Loading delivery information…';
  if(page==='public'){
   const unlistedOption=$('bp-unlisted-option');if(unlistedOption)unlistedOption.hidden=!(liveGuestEnabled&&unlistedEnabled);
   const subtitle=document.querySelector('.public-form .subtitle');
   if(subtitle)subtitle.textContent=syntheticDemo?'Practice reports stay in this browser. Leave out personal information.':'Choose a restaurant and describe one order.';
   $('bp-report-privacy').hidden=syntheticDemo;
   if(location.hash==='#report-form-section')requestAnimationFrame(openReportPrivacy);
   if(!syntheticDemo)$('bp-public-footer-note').textContent='Campus delivery reports and restaurant analytics.';
   const tag=document.querySelector('#recent .section-tag');if(tag)tag.textContent=syntheticDemo?'SYNTHETIC DEMO REPORTS · BROWSER-LOCAL PRACTICE':'Student feedback';
   const help=document.querySelector('#recent .small.muted');if(help)help.textContent=syntheticDemo?'Sample reports are fabricated; your practice submissions stay in this browser. No real orders are represented.':'Recent self-reported submissions.';
   const tip=$('audit-form')?.querySelector('.demo-tip');
   if(tip){tip.hidden=liveGuestEnabled;tip.textContent=syntheticDemo?'Practice reports are stored in this browser.':'Guest submissions are disabled.';}
   const submit=$('audit-form')?.querySelector('[type="submit"]');if(submit){submit.textContent=syntheticDemo?'Save browser-only demo report':liveGuestEnabled?'Submit report':'Reports temporarily disabled';submit.disabled=!(syntheticDemo||liveGuestEnabled);}
  }else{
   const {oldest,today}=dateLimits();
   const from=$('bp-custom-from'),to=$('bp-custom-to');
   for(const input of [from,to]){input.min=oldest;input.max=today;}
   if(!manualPeriodSelected){
    from.value=customFrom=localDay(shiftDay(reportingToday(),-29));
    to.value=customTo=today;
   }
   const button=$('simulate-refresh');if(button){button.textContent='Refresh';button.onclick=()=>{liveHasObservations=null;renderPeriodCaption();return window.BluePlateBridge.refreshDashboard().catch(()=>{});};}
  }
  if(syntheticDemo){notice.style.background='#172c46';notice.style.color='#f5f8ff';notice.style.border='1px solid #486a91';}
  if(page==='admin')renderAdmin();else {renderPublicReviews();}
 },
 setWarehouseFreshness(value){warehouseFreshness=value;renderPeriodCaption();if(studentPeriod)renderStudentNotices();},
 setGuestReportDate(date){
  latestGuestReportDate=date;
  renderPeriodCaption();
 },
 setReportingCoverage(latest, latestReport, allowDefault){
  const selected = currentRange();
  latestReportingDate=latest;
  latestReportSubmissionDate=latestReport;
  $('bp-latest-period').classList.toggle('hidden',!latest);
  $('bp-latest-report-period').classList.toggle('hidden',!latestReport);
  if((periodPreset==='latest'&&!latest)||(periodPreset==='latest-report'&&!latestReport)){
   periodPreset='custom';
   customFrom=selected.from;
   customTo=selected.to;
  }
  if(latest&&allowDefault&&!manualPeriodSelected)periodPreset='latest';
  syncPeriodButtons();
  renderPeriodCaption();
 },
 setPublic(restaurants){
  state.restaurants=restaurants;
  const select=$('audit-restaurant');select.innerHTML='<option value="" disabled selected>Choose a restaurant</option>'+restaurants.filter(r=>r.guestReportingEligible!==false).map(r=>`<option value="${r.id}">${html(r.name)} · ${html(r.branch)}</option>`).join('');
  select._bpClear?.();const input=$('restaurant-search');if(input)input.placeholder=`Search eligible restaurants…`;
  const box=$('bp-live-notice');if(box)box.textContent=syntheticDemo?`SYNTHETIC DEMO MODE · ${restaurants.length} real OSM restaurant identities from local MySQL; all sample reports fabricated and browser-only. No real performance observations. © OpenStreetMap contributors (ODbL).`:`Restaurant selection · Venues: © OpenStreetMap contributors (ODbL). ${liveGuestEnabled?'Guest reports enabled.':'Submissions currently disabled.'}`;
 },
 setPublicReviews(reports){
  if(syntheticDemo){const local=safeRead(REPORT_KEY).filter(r=>state.restaurants.some(x=>x.id===Number(r.restaurantId))).map(r=>{const x=state.restaurants.find(v=>v.id===Number(r.restaurantId));return {restaurant_name:x.name,zone_name:x.zone,rating_score:Number(r.rating),order_was_cancelled:!!r.cancelled,actual_observed_delivery_mins:r.minutes,comment_text:String(r.notes||''),submission_source:'BROWSER DEMO ONLY',submitted_at:r.createdAt};});liveReports=[...local,...reports];}
  else liveReports=reports;renderPublicReviews();},
 configureCurrentModel(available, params, student=false){
  studentMode=student;
  if(student){
   document.body.classList.add('bp-student-dashboard');
   for(const id of ['bp-current-period','bp-latest-period','bp-latest-report-period'])$(id).remove();
   $('bp-available-period').classList.remove('hidden');
   periodPreset='available';manualPeriodSelected=true;
  }
  currentModelAvailable=available;
  $('bp-current-period')?.classList.toggle('hidden',!available);
  const from=params.get('from'),to=params.get('to');
  const historical=params.get('model')==='legacy'||from||to;
  if(!student&&available&&!historical){periodPreset='current';manualPeriodSelected=true;}
  const limits=dateLimits();
  if(from&&to&&/^\d{4}-\d\d-\d\d$/.test(from)&&/^\d{4}-\d\d-\d\d$/.test(to)&&from>=limits.oldest&&to<=limits.today&&from<=to){
   customFrom=from;customTo=to;periodPreset='custom';manualPeriodSelected=true;
   $('bp-custom-from').value=from;$('bp-custom-to').value=to;$('bp-custom-dates').classList.remove('hidden');
  }
  syncPeriodButtons();
 },
 isLatestAvailable:()=>periodPreset==='available',
 wantsCurrentModel(){return currentModelAvailable&&(periodPreset==='current'||Boolean(selectedScenarioDate()));},
 scenarioDate:()=>selectedScenarioDate(),
 setAdmin({restaurants,alerts,trend,demo=false,hasObservations=null,reportTotals={},directoryCoverage=null,model=null,student=null}){
  syntheticDemo=!!demo;
  studentPeriod=student;
  const previousModel=Boolean(currentModel);
  currentModel=model?{...model,liveCoverage:directoryCoverage}:null;
  if(student)$('bp-export-directory').disabled=!student.snapshot;
  $('bp-model-controls').hidden=!model;
  $('bp-notices-info').hidden=!student;
  $('bp-student-experiences').hidden=!student;
  $('bp-alert-filter-tools').hidden=Boolean(student);
  if(student)document.querySelector('.sidebar-caption').textContent='Delivery estimates and feedback from UST students.';
  $('bp-street-filter').hidden=!model;
  if(model)$('bp-latest-period')?.classList.remove('hidden');
  const health=$('filter-health');
  const healthControls=[document.querySelector('label[for="filter-health"]'),health,health.nextElementSibling];
  for(const control of healthControls.slice(0,2).filter(Boolean))control.hidden=Boolean(model||student);
  if(healthControls[2]?.classList.contains('bp-compact-select'))healthControls[2].hidden=Boolean(model||student);
  if(model||student)health.value='ALL';
  if(previousModel!==Boolean(model))$('sort-popover').dispatchEvent(new Event('bp-reset-sort'));
  const headings=student?['Restaurant','Zone and address','Distance','Estimated delivery','Travel difficulty','Simulated orders/day','Student rating','Student reports']:model?['Restaurant','Distance band & address','Distance','Scenario ETA','Transit stress','Hypothetical demand/day','Guest rating','Guest reports']
   :['Restaurant','Zone & gate','Distance','Modeled menu price','Delivery ETA','Risk index','Rating','Health'];
  document.querySelectorAll('#restaurants thead th').forEach((th,i)=>{th.textContent=headings[i];});
  for(const button of $('sort-popover').querySelectorAll('[data-sort-key]')){
   button.hidden=(Boolean(model||student)&&['price','health'].includes(button.dataset.sortKey))||(Boolean(student&&!model)&&button.dataset.sortKey==='risk');
   if(button.dataset.sortKey==='risk')button.querySelector('.sort-choice-name').textContent=student?'Travel difficulty':model?'Transit stress':'Risk';
  }
  const updateOptions=(id,values,all)=>{
   const control=$(id),old=control.value;
   control.replaceChildren(new Option(all,'ALL'),...values.map(v=>new Option(v,v)));
   control.value=values.includes(old)?old:'ALL';
   const wrapper=control.nextElementSibling;
   if(wrapper?.classList.contains('bp-compact-select')){wrapper.remove();control.classList.remove('bp-native-select');}
  };
  updateOptions('filter-zone',[...new Set(restaurants.map(r=>r.zone))].sort(),'All zones');
  updateOptions('filter-street',model?Object.keys(model.address_clusters).sort():[],'All areas');
  const coverage=$('bp-directory-cohorts');
  if(coverage){
   coverage.hidden=!directoryCoverage||Boolean(model||student);
   if(directoryCoverage&&!model)coverage.textContent=`Public directory: ${directoryCoverage.public_listings} · Modeled venues in period: ${directoryCoverage.modeled_venues} · Venues with guest self-reports in period: ${directoryCoverage.guest_self_reported_venues}`;
  }
  state.restaurants=restaurants;state.alerts=alerts;liveTrend=trend;liveHasObservations=hasObservations;liveReportTotals=reportTotals;
  dashboardLoadedAt=new Date();
  liveError='';
  const cuisine=$('filter-cuisine');const previous=cuisine.value;
  cuisine.innerHTML='<option value="ALL">All cuisines</option>'+[...new Set(restaurants.map(r=>r.cuisine))].sort().map(c=>`<option value="${html(c)}">${html(c)}</option>`).join('');
  cuisine.value=[...cuisine.options].some(o=>o.value===previous)?previous:'ALL';
  // Compact menu was created from the previous sample options: rebuild it.
  const wrapper=cuisine.nextElementSibling;if(wrapper?.classList.contains('bp-compact-select')){wrapper.remove();cuisine.classList.remove('bp-native-select');}initCompactSelects();
  renderAdmin();renderPeriodCaption();
  const box=$('bp-live-notice');if(box)box.hidden=Boolean(student);if(box)box.textContent=syntheticDemo?`SYNTHETIC DEMO MODE · ${restaurants.length} real OSM restaurant identities · ${trend.length} fabricated days · ${alerts.length} simulated alerts. No real ratings, deliveries, risk events or recorded operational actions. © OpenStreetMap contributors (ODbL).`:'Restaurant listings © OpenStreetMap contributors (ODbL).';
  const footer=document.querySelector('.footer');if(footer)footer.textContent=syntheticDemo?'BluePlate · SYNTHETIC DEMONSTRATION · OSM venue directory, no real performance data.':'BluePlate · UST Manila · Restaurant listings © OpenStreetMap contributors (ODbL).';
 },
 notice(message){const el=$('bp-live-notice');if(el){el.textContent=String(message);el.classList.remove('bp-live-error');}else toast(String(message));},
 showError(message){
  liveError=liveRequired?'Dashboard data is temporarily unavailable. Please try again.':String(message);
  studentPeriod=null;state.restaurants=[];state.alerts=[];liveTrend=[];liveReports=[];liveReportTotals={};
  if(page==='admin'){
   liveHasObservations=null;
   dashboardLoadedAt=null;
   $('bp-detail-dialog')?.close();
   renderAdmin();renderPeriodCaption();
  }else{
   const submit=$('audit-form').querySelector('[type="submit"]');
   submit.disabled=true;
   liveGuestEnabled=false;
   $('audit-restaurant').replaceChildren();
   $('audit-restaurant')._bpClear?.();
   $('recent-reviews').replaceChildren();
  }
  const notice=liveNotice();
  notice.hidden=false;
  notice.textContent=liveRequired?liveError:`Warehouse data unavailable: ${liveError}. Demo figures are intentionally hidden.`;
  notice.classList.add('bp-live-error');
 },
 getRange:()=>currentRange()
};

if(!liveRequired){initModeledHistory();hydrate();}initSettings();if(page==='public')initPublic();if(page==='admin')initAdmin();
window.addEventListener('storage',e=>{if(!liveRequired && e.key===REPORT_KEY){location.reload();}});
})();

