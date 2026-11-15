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
function testChart(trend){
 const from=source.indexOf('function renderCharts(){');
 const to=source.indexOf('\nfunction refreshCharts()',from);
 assert(from>=0&&to>=0);
 const fn=source.slice(from,to);
 const panels={}, elements={};
 for(const [chartId,key] of [['zone-chart','zone'],['trend-chart','trend'],['cuisine-chart','cuisine']]){
  const panel={head:{textContent:''},desc:{textContent:''},box:{replaceChildren(){},append(){}},querySelector(q){return q==='h3'?this.head:q==='p'?this.desc:this.box;}};
  panels[key]=panel;elements[chartId]={parentElement:panel,closest(){return panel;}};
 }
 const configs=[];
 class MockChart{constructor(target,cfg){configs.push({target,cfg});}destroy(){}}
 const ctx={
  liveMode:true,syntheticDemo:false,liveTrend:trend,charts:[],Chart:MockChart,
  $:id=>elements[id],
  enriched:()=>[
   {zone:'UST - Dapitan St',cuisine:'Cafe',streetAddress:'St 1',eta:15,cancellationProxyPct:3.2,blendedRating:null},
   {zone:'UST - Dapitan St',cuisine:'Cafe',streetAddress:'',eta:null,cancellationProxyPct:null,blendedRating:null},
   {zone:'UST - España Blvd',cuisine:'Bakery',streetAddress:'St 3',eta:null,cancellationProxyPct:null,blendedRating:4.5}
  ],
  console
 };
 vm.runInNewContext(fn+'\nrenderCharts()',ctx);
 assert.strictEqual(configs.length,3);
 assert.strictEqual(configs[0].cfg.data.datasets[0].data[0],2,'UST zone count should be real inventory count');
 assert.strictEqual(configs[2].cfg.data.datasets[0].data[0],2,'Cuisine count should be real inventory count');
 return {configs,panels};
}
const a=testChart([{date:'2026-11-15',orders:3000,eta:15.7}]);
assert.strictEqual(a.configs[1].cfg.type,'bar','Single-date trend must not look like a multi-day line');
assert.strictEqual(a.panels.trend.head.textContent,'Available delivery history');
const b=testChart([]);
assert.strictEqual(b.panels.trend.head.textContent,'Warehouse data coverage');
assert.strictEqual(b.configs[1].cfg.data.datasets[0].data[0],2);
console.log('PASS: cautious deduplication preserves distinct branches');
console.log('PASS: zone and cuisine charts use current restaurant counts');
console.log('PASS: one-day history is rendered as a bar, absent history as data coverage');
