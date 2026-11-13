import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decodeOrders,filterOrders,summarizeOrders,monthlyOrders,orderMix,topOrderItems,orderExport,defaultTransactionFilters,isPaid} from '../lib/transactions.ts';
import {round} from '../lib/analytics.ts';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const core=read('../public/data/blueplate.json'),raw=read('../public/data/orders.json'),control=read('./order-controls.json');
const data=decodeOrders(raw,core.restaurants),global=summarizeOrders(data.orders);
for(const [key,value] of Object.entries({orders:64000,paidOrders:60762,cancelled:3238,customers:19196,units:303471,promoted:5000,paidPromoted:4751,reviewCount:24329}))assert.equal(global[key],value,key);
assert.equal(round(global.cancellation),5.06);assert.equal(round(global.deliveryMinutes),55.56);assert.equal(round(global.rating),3.47);
// These controls were calculated independently from CSVs using Decimal cents.
for(const expected of [...control.countryCurrencyControls,...control.cityCurrencyControls,...control.monthlyCountryCurrencyControls]){
 const filter={...defaultTransactionFilters,country:expected.country,city:expected.city||'',start:expected.month?expected.month+'-01':'',end:expected.month?expected.month+'-31':''};
 const rows=filterOrders(data.orders,filter),s=summarizeOrders(rows),money=s.currencies.find(c=>c.currency===expected.currency);
 assert.equal(s.orders,expected.orders);assert.equal(s.paidOrders,expected.deliveredPaidOrders);assert.equal(s.cancelled,expected.cancelledOrders);
 assert.equal(money.spendCents,Math.round(expected.paidCustomerSpend*100));assert.equal(round(money.aovCents/100),expected.paidAOV);
 assert.equal(money.discountCents,Math.round(expected.paidDiscounts*100));assert.equal(round(s.deliveryMinutes),expected.avgDeliveryMinutes);assert.equal(s.reviewCount,expected.reviews);
}
assert.equal(monthlyOrders(data.orders,'USD').reduce((n,m)=>n+m.spendCents,0),345913764);
assert.deepEqual(orderMix(data.orders.filter(isPaid),'paymentMethod'),[{name:'E-Wallet',value:20278},{name:'Card',value:20244},{name:'Cash',value:20240}]);
const cancelled=filterOrders(data.orders,{...defaultTransactionFilters,status:'Cancelled'});assert.equal(summarizeOrders(cancelled).paidOrders,0);assert.ok(summarizeOrders(cancelled).currencies.every(c=>c.spendCents===0&&c.aovCents===null));assert.equal(topOrderItems(cancelled,data.menus).length,0);
const empty=filterOrders(data.orders,{...defaultTransactionFilters,start:'2024-01-01'});assert.equal(empty.length,0);assert.equal(summarizeOrders(empty).cancellation,null);
assert.ok(filterOrders(data.orders,{...defaultTransactionFilters,start:'2023-01-01',end:'2023-01-01'}).every(o=>o.date==='2023-01-01'));
const selection=filterOrders(data.orders,{...defaultTransactionFilters,method:'Cash',segment:'Premium',tier:'Gold',country:'India',city:'Delhi'});assert.ok(selection.length>0&&selection.every(o=>o.paymentMethod==='Cash'&&o.segment==='Premium'&&o.tier==='Gold'&&o.city==='Delhi'));
assert.equal(orderExport(selection).length,selection.length);assert.ok(orderExport(cancelled).every(r=>r.Paid_customer_spend===0&&r.Synthetic_data===true));
assert.equal(data.checks.length,16);assert.deepEqual(data.checks.filter(c=>c.failed).map(c=>c.failed),[2701,853]);
assert.equal(new Set(data.orders.map(o=>o.id)).size,64000);
console.log(JSON.stringify({result:'PASS',orders:global.orders,paidOrders:global.paidOrders,cancellationPct:round(global.cancellation),avgDelivery:round(global.deliveryMinutes),currencyControls:5,cityControls:10,monthCurrencyControls:60,checks:data.checks.length},null,2));
