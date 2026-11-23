// Regression tests for the website patch; no browser/API/MySQL required.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root,'frontend/assets/api-bridge.js'),'utf8');
const source = fs.readFileSync(path.join(root,'frontend/assets/app.js'),'utf8');
const start = bridge.indexOf('function uniqueRestaurants(rows) {');
const end = bridge.indexOf('  async function refreshAdmin(range)',start);
assert(start !== -1 && end !== -1);
const helper = bridge.slice(start,end);
let context = {};
vm.runInNewContext(helper+'\nthis.uniqueRestaurants=uniqueRestaurants',context);
const restaurant=(id,name,address,externalPlaceId='',zone='UST - Dapitan St')=>({
 id,name,streetAddress:address,branchLabel:'',externalPlaceId,zone
});
const rows=[
 restaurant(1,"Dunkin'","1669 Recto Ave","osm/a"),
 restaurant(2,"Dunkin'","Earnshaw St","osm/b"),
 restaurant(3,"Dunkin'","1669 Recto Ave","osm/c"),
 restaurant(4,"Baker's Fair","","osm/d"),
 restaurant(5,"Baker's Fair","","osm/e"),
 restaurant(6,"Foo","Some St","osm/b"),
];
const unique=context.uniqueRestaurants(rows);
assert.strictEqual(unique.length,4,'Must remove same-location and same-source duplicates, not distinct branches');
assert.deepStrictEqual(Array.from(unique,r=>r.id),[1,2,4,5]);
const normalizerStart = bridge.indexOf('  function numberOrNull(');
const normalizerEnd = bridge.indexOf('  // Suppress only demonstrable',normalizerStart);
vm.runInNewContext(bridge.slice(normalizerStart,normalizerEnd)+'\nthis.restaurant=restaurant',context);
const mapped = context.restaurant({restaurant_key:1, restaurant_name:'Fixture',
 street_address:' Address not recorded in OSM ', public_avg_rating:null, auditor_avg_rating:5,
 report_rating_count:1, warehouse_rating_days:0});
assert.strictEqual(mapped.streetAddress,'');
assert.strictEqual(context.restaurant({street_address:'Sampaloc, Manila'}).streetAddress,'');
assert.strictEqual(mapped.publicRating,null);
assert.strictEqual(mapped.selfReportedRating,5);
assert.strictEqual(mapped.reportRatingCount,1);
assert.strictEqual(context.restaurant({street_address:'123 Sample Street'}).streetAddress,'123 Sample Street');

function testChart(trend, chartAvailable=true, dark=false){
 const from=source.indexOf('function chartTheme(){');
 const to=source.indexOf('\nfunction refreshCharts()',from);
 assert(from>=0&&to>=0);
 const fn=source.slice(from,to);
 const panels={}, elements={};
 for(const [chartId,key] of [['zone-chart','zone'],['trend-chart','trend'],['cuisine-chart','cuisine']]){
  const panel={head:{textContent:''},desc:{textContent:''},querySelector(q){return q==='h3'?this.head:q==='p'?this.desc:this.box;}};
  const canvas={closest(){return panel;},setAttribute(){}};
  panel.box={querySelector(q){return q==='canvas'?canvas:null;},append(item){this.textContent=item.textContent;}};
  canvas.parentElement=panel.box;
  panels[key]=panel;elements[chartId]=canvas;
 }
 const configs=[];
 let destroyed=0;
 class MockChart{constructor(target,cfg){configs.push({target,cfg});}destroy(){destroyed++;}}
 const palette=dark?{ink:'#d7e5f7',grid:'#526780',axis:'#8da5c3',blue:'#79aaff',teal:'#65d5bb'}:
  {ink:'#334760',grid:'#c2cfdf',axis:'#8498b0',blue:'#3772e9',teal:'#007e74'};
 const ctx={
  liveMode:true,syntheticDemo:false,liveTrend:trend,charts:[],Chart:chartAvailable?MockChart:undefined,
  document:{createElement:()=>({})},
  getComputedStyle:()=>({getPropertyValue:name=>palette[name.slice(8)]}),
  $:id=>elements[id],
  enriched:()=>[
   {zone:'UST - Dapitan St',cuisine:'Cafe',streetAddress:'St 1',eta:15,cancellationProxyPct:3.2,publicRating:null,selfReportedRating:5},
   {zone:'UST - Dapitan St',cuisine:'Cafe',streetAddress:'',eta:null,cancellationProxyPct:null,publicRating:null},
   {zone:'UST - España Blvd',cuisine:'Bakery',streetAddress:'St 3',eta:null,cancellationProxyPct:null,publicRating:4.5}
  ],
  console
 };
 vm.runInNewContext(fn+'\nrenderCharts()',ctx);
 if(!chartAvailable)return {panels};
 assert.strictEqual(configs.length,3);
 assert.strictEqual(configs[0].cfg.data.datasets[0].data[0],2,'UST zone count should be real inventory count');
 assert.strictEqual(configs[2].cfg.data.datasets[0].data[0],2,'Cuisine count should be real inventory count');
 for(const {cfg} of configs){
  assert.strictEqual(cfg.options.plugins.legend.labels.color,palette.ink);
  for(const axis of Object.values(cfg.options.scales)){
   assert.strictEqual(axis.ticks.color,palette.ink);
   assert.strictEqual(axis.title.color,palette.ink);
   assert.strictEqual(axis.grid.color,palette.grid);
   assert.strictEqual(axis.border.color,palette.axis);
  }
 }
 vm.runInNewContext('renderCharts()',ctx);
 assert.strictEqual(destroyed,3,'Every canvas redraws when the theme is reapplied');
 return {configs:configs.slice(0,3),panels};
}
const a=testChart([{date:'2026-11-15',orders:3000,eta:15.7}]);
assert.strictEqual(a.configs[1].cfg.type,'bar','Single-date trend must not look like a multi-day line');
assert.strictEqual(a.panels.trend.head.textContent,'Modeled warehouse snapshot');
assert.match(a.panels.trend.desc.textContent,/2026-11-15/);
const fallback=testChart([{date:'2026-11-15',orders:null,eta:15.7}],false);
assert.match(fallback.panels.trend.box.textContent,/Modeled demand: Unavailable; modeled ETA: 15.7/);
const b=testChart([]);
assert.strictEqual(b.panels.trend.head.textContent,'Warehouse data coverage');
assert.strictEqual(b.configs[1].cfg.data.datasets[0].data[0],2);
const dark=testChart([{date:'2026-11-15',orders:null,eta:15.7}],true,true);
assert.strictEqual(dark.configs[1].cfg.data.datasets.length,1,'Absent demand must stay absent');
assert.strictEqual(dark.configs[1].cfg.data.datasets[0].data[0],15.7);
assert.strictEqual(dark.configs[1].cfg.options.scales.y.title.text,'Minutes');
testChart([],true,true);
const coverageStart=source.indexOf('function renderDirectoryCoverage(');
const coverageEnd=source.indexOf('function reportMetrics(',coverageStart);
const coveragePanel={};
vm.runInNewContext(source.slice(coverageStart,coverageEnd)+'\nrenderDirectoryCoverage();',{
 $:()=>coveragePanel,liveMode:true,syntheticDemo:false,html:String,
 state:{restaurants:[{cuisine:'Unclassified / Pending Review',zone:'UST',streetAddress:''}]}
});
assert.match(coveragePanel.innerHTML,/<strong>1<\/strong><span>unclassified cuisine<\/span>/);

const metricsStart=source.indexOf('function sampleLabel(');
const metricsEnd=source.indexOf('function renderKpis(',metricsStart);
const metricContext={
 liveNumber:v=>v==null?null:Number(v),
 numberText:(v,places=1)=>Number.isFinite(v)?v.toFixed(places):'—'
};
vm.runInNewContext(source.slice(metricsStart,metricsEnd)+'\nthis.reportMetrics=reportMetrics;',metricContext);
const values=report=>JSON.parse(JSON.stringify(metricContext.reportMetrics(report)));
const zero=values({});
assert.deepStrictEqual(zero.map(metric=>metric[1]),['0','Not available','Not available','Not available']);
assert.strictEqual(zero[3][2],'0 cancelled out of 0 reports with a known outcome');
const one=values({auditor_report_count:1,report_rating_count:1,auditor_avg_rating:5,
 cancelled_report_count:1,known_outcome_count:1,reported_cancellation_share:1});
assert.deepStrictEqual(one.map(metric=>metric[1]),['1','5.00 / 5','Not available','100.0%']);
assert.strictEqual(one[1][2],'Based on 1 rating');
const many=values({auditor_report_count:6,report_rating_count:5,auditor_avg_rating:4,
 completed_delivery_count:2,observed_delivery_mins:50,cancelled_report_count:1,
 known_outcome_count:5,reported_cancellation_share:0.2});
assert.deepStrictEqual(many.map(metric=>metric[1]),['6','4.00 / 5','50.0 min','20.0%']);
assert.strictEqual(many[2][2],'Based on 2 completed deliveries');
assert.match(many[3][2],/1 cancelled out of 5/);

const directoryStart=source.indexOf('function directoryRows()');
const directoryEnd=source.indexOf('function chartTheme()',directoryStart);
const controls=Object.fromEntries([
 'directory-search','filter-zone','filter-health','filter-cuisine','restaurant-count','filter-summary',
 'directory-rows','bp-directory-pagination','bp-directory-prev','bp-directory-next','bp-directory-position'
].map(id=>[id,{value:'ALL',focus(){this.focused=true;}}]));
controls['directory-search'].value='';
let listings=Array.from({length:119},(_,i)=>({
 id:i+1,name:`Restaurant ${String(i+1).padStart(3,'0')}`,branch:'',streetAddress:i===0?'Fixture Lane':'',
 zone:i<12?'UST - Zone A':'UST - Zone B',cuisine:'Cafe',health:'UNKNOWN',distance:999,
 avgPricePhp:i===0?125:null,eta:null,cancellationProxyPct:null,publicRating:4.3,warehouseRatingDays:0,
 selfReportedRating:i===0?5:null,reportRatingCount:i===0?1:0
}));
const directoryContext={...metricContext,$:id=>controls[id],enriched:()=>listings,html:String,
 liveMode:true,syntheticDemo:false,dateRangeLabel:()=> '2026-11-15'};
vm.runInNewContext(`const DIRECTORY_PAGE_SIZE=10;let directoryPage=1,sortBy='default';\n`+
 source.slice(metricsStart,metricsEnd)+source.slice(directoryStart,directoryEnd),directoryContext);
const runDirectory=code=>vm.runInNewContext(code,directoryContext);
const rowIds=()=>Array.from(controls['directory-rows'].innerHTML.matchAll(/data-restaurant-detail="(\d+)"/g),m=>Number(m[1]));
runDirectory('renderDirectory()');
assert.equal(controls['restaurant-count'].textContent,'· 119 matching results');
assert.match(controls['bp-directory-position'].textContent,/Page 1 of 12/);
assert.equal(rowIds().length,10);
assert.match(controls['directory-rows'].innerHTML,/₱125.*Modeled average/);
assert.match(controls['directory-rows'].innerHTML,/Based on 1 rating/);
assert.doesNotMatch(controls['directory-rows'].innerHTML,/4\.30/);
const seen=new Set(rowIds());
for(let page=2;page<=12;page++){
 runDirectory('changeDirectoryPage(1)');
 for(const id of rowIds())seen.add(id);
}
assert.equal(seen.size,119);
assert.equal(rowIds().length,9);
assert.equal(controls['bp-directory-next'].disabled,true);
assert.equal(controls['bp-directory-prev'].focused,true);
controls['directory-search'].value='Fixture Lane';
runDirectory('renderDirectory()');
assert.deepStrictEqual(rowIds(),[1]);
controls['directory-search'].value='';
controls['filter-zone'].value='UST - Zone A';
runDirectory('renderDirectory()');
assert.match(controls['bp-directory-position'].textContent,/Page 1 of 2/);
runDirectory("sortBy='name-desc'; renderDirectory()");
assert.equal(rowIds()[0],12);
runDirectory('changeDirectoryPage(1)');
listings=listings.slice(0,4);
runDirectory('renderDirectory(true)');
assert.match(controls['bp-directory-position'].textContent,/Page 1 of 1/);
controls['directory-search'].value='no match';
runDirectory('renderDirectory()');
assert.equal(controls['bp-directory-position'].textContent,'No matching results');

const kpiFields={kpis:{},'executive-summary':{}};
const kpiSource=source.slice(metricsStart,source.indexOf('function demoAlerts()',metricsEnd));
const kpiContext={...metricContext,$:id=>kpiFields[id],html:String,badge:()=>'',liveMode:true,syntheticDemo:false,
 liveTrend:[{date:'2026-11-15'}],periodPreset:'latest',liveReportTotals:{},state:{alerts:[]},
 enriched:()=>[{zone:'UST',cuisine:'Cafe',streetAddress:'',eta:15.67,cancellationProxyPct:3.35,publicRating:null,selfReportedRating:null}]};
vm.runInNewContext(kpiSource,kpiContext);
const showKpis=()=>vm.runInNewContext('renderKpis()',kpiContext);
const cardCount=()=>[...kpiFields.kpis.innerHTML.matchAll(/class="kpi kpi--/g)].length;
const warehouseSupport=showKpis();
assert.equal(cardCount(),5);
assert.match(kpiFields.kpis.innerHTML,/Modeled delivery/);
assert.doesNotMatch(kpiFields.kpis.innerHTML,/Self-reported rating/);
assert(warehouseSupport.some(([label,value])=>label==='Accepted reports'&&value==='0'));
kpiContext.periodPreset='latest-report';
kpiContext.liveTrend=[];
kpiContext.liveReportTotals={auditor_report_count:1,report_rating_count:1,auditor_avg_rating:5,
 completed_delivery_count:1,observed_delivery_mins:30,known_outcome_count:1,reported_cancellation_share:0};
const reportSupport=showKpis();
assert.equal(cardCount(),5);
assert.match(kpiFields.kpis.innerHTML,/Based on 1 completed delivery/);
assert.match(kpiFields.kpis.innerHTML,/0 cancelled out of 1 report/);
assert.doesNotMatch(kpiFields.kpis.innerHTML,/Modeled delivery/);
assert(reportSupport.some(([label])=>label==='Modeled delivery'));

console.log('PASS: cautious deduplication preserves distinct branches');
console.log('PASS: zone and cuisine charts use current restaurant counts');
console.log('PASS: one-day history is rendered as a bar, absent history as data coverage');
console.log('PASS: directory pagination and separate warehouse/report KPI contexts');
