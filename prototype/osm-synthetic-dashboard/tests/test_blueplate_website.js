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

function testChart(trend, chartAvailable=true){
 const from=source.indexOf('function renderCharts(){');
 const to=source.indexOf('\nfunction refreshCharts()',from);
 assert(from>=0&&to>=0);
 const fn=source.slice(from,to);
 const panels={}, elements={};
 for(const [chartId,key] of [['zone-chart','zone'],['trend-chart','trend'],['cuisine-chart','cuisine']]){
  const panel={head:{textContent:''},desc:{textContent:''},box:{replaceChildren(){},append(item){this.textContent=item.textContent;}},querySelector(q){return q==='h3'?this.head:q==='p'?this.desc:this.box;}};
  panels[key]=panel;elements[chartId]={parentElement:panel,closest(){return panel;}};
 }
 const configs=[];
 class MockChart{constructor(target,cfg){configs.push({target,cfg});}destroy(){}}
 const ctx={
  liveMode:true,syntheticDemo:false,liveTrend:trend,charts:[],Chart:chartAvailable?MockChart:undefined,
  document:{createElement:()=>({})},
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
 return {configs,panels};
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
const coverageStart=source.indexOf('function renderDirectoryCoverage(');
const coverageEnd=source.indexOf('function reportMetrics(',coverageStart);
const coveragePanel={};
vm.runInNewContext(source.slice(coverageStart,coverageEnd)+'\nrenderDirectoryCoverage();',{
 $:()=>coveragePanel,liveMode:true,syntheticDemo:false,html:String,
 state:{restaurants:[{cuisine:'Unclassified / Pending Review',zone:'UST',streetAddress:''}]}
});
assert.match(coveragePanel.innerHTML,/<strong>1<\/strong><span>unclassified cuisine<\/span>/);

const metricsStart=source.indexOf('function reportMetrics(');
const metricsEnd=source.indexOf('function renderKpis(',metricsStart);
const metricContext={
 liveNumber:v=>v==null?null:Number(v),
 numberText:(v,places=1)=>Number.isFinite(v)?v.toFixed(places):'—'
};
vm.runInNewContext(source.slice(metricsStart,metricsEnd)+'\nthis.reportMetrics=reportMetrics;',metricContext);
const values=report=>JSON.parse(JSON.stringify(metricContext.reportMetrics(report)));
const zero=values({});
assert.deepStrictEqual(zero.map(metric=>metric[1]),['0','Unavailable','Unavailable','Unavailable']);
assert.strictEqual(zero[3][2],'0 cancelled / 0 reports with known outcomes');
const one=values({auditor_report_count:1,report_rating_count:1,auditor_avg_rating:5,
 cancelled_report_count:1,known_outcome_count:1,reported_cancellation_share:1});
assert.deepStrictEqual(one.map(metric=>metric[1]),['1','5.00 / 5','Unavailable','100.0%']);
assert.strictEqual(one[1][2],'n = 1 rating');
const many=values({auditor_report_count:6,report_rating_count:5,auditor_avg_rating:4,
 completed_delivery_count:2,observed_delivery_mins:50,cancelled_report_count:1,
 known_outcome_count:5,reported_cancellation_share:0.2});
assert.deepStrictEqual(many.map(metric=>metric[1]),['6','4.00 / 5','50.0 min','20.0%']);
assert.match(many[2][2],/n = 2 completed reports/);
assert.match(many[3][2],/1 cancelled \/ 5/);

console.log('PASS: cautious deduplication preserves distinct branches');
console.log('PASS: zone and cuisine charts use current restaurant counts');
console.log('PASS: one-day history is rendered as a bar, absent history as data coverage');
