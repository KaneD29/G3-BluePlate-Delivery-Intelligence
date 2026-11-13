import {type Restaurant, type Check, mean, matches} from './analytics.ts';

export type Order = {
  id:number;restaurantId:string;customerId:number;date:string;status:string;currency:string;
  subtotalCents:number;discountCents:number;totalCents:number;paymentStatus:string;paymentMethod:string;
  paidCents:number;segment:string;promo:string|null;actualMinutes:number|null;estimatedMinutes:number|null;
  vehicle:string|null;rating:number|null;tier:string;commissionRate:number;signupConflict:boolean;hireConflict:boolean;
  items:[number,number,number][];restaurant:string;country:string;city:string;
};
export type TransactionData={metadata:{label:string;periodStart:string;periodEnd:string;files:Record<string,number>};orders:Order[];menus:[string,string][];checks:(Check&{note:string})[]};
export type TransactionFilters={country:string;city:string;start:string;end:string;status:string;method:string;segment:string;tier:string};
export const defaultTransactionFilters:TransactionFilters={country:'',city:'',start:'',end:'',status:'',method:'',segment:'',tier:''};
export function decodeOrders(raw:{metadata:TransactionData['metadata'];fields:string[];rows:unknown[][];menus:[string,string][];checks:TransactionData['checks']},restaurants:Restaurant[]):TransactionData{
  const lookup=new Map(restaurants.map(r=>[r.id,r]));
  return {metadata:raw.metadata,menus:raw.menus,checks:raw.checks,orders:raw.rows.map(row=>{const order=Object.fromEntries(raw.fields.map((f,i)=>[f,row[i]])) as Order;const r=lookup.get(order.restaurantId);if(!r)throw Error('Order restaurant is missing');return {...order,restaurant:r.name,country:r.country,city:r.city};})};
}
export const isPaid=(o:Order)=>o.status==='Delivered'&&o.paymentStatus==='Paid';
export function filterOrders(orders:Order[],f:TransactionFilters){return orders.filter(o=>matches(o,f.country,f.city)&&(!f.start||o.date>=f.start)&&(!f.end||o.date<=f.end)&&(!f.status||o.status===f.status)&&(!f.method||o.paymentMethod===f.method)&&(!f.segment||o.segment===f.segment)&&(!f.tier||o.tier===f.tier));}
export function summarizeOrders(rows:Order[]){
  const paid=rows.filter(isPaid),cancelled=rows.filter(o=>o.status==='Cancelled').length,reviews=paid.filter(o=>o.rating!==null);
  const currencies=[...new Set(rows.map(o=>o.currency))].sort().map(currency=>{
    const all=rows.filter(o=>o.currency===currency),eligible=all.filter(isPaid),spend=eligible.reduce((s,o)=>s+o.paidCents,0);
    return {currency,orders:all.length,paidOrders:eligible.length,spendCents:spend,aovCents:eligible.length?spend/eligible.length:null,discountCents:eligible.reduce((s,o)=>s+o.discountCents,0),refundedCents:all.filter(o=>o.paymentStatus==='Refunded').reduce((s,o)=>s+o.totalCents,0),voidedCents:all.filter(o=>o.paymentStatus==='Voided').reduce((s,o)=>s+o.totalCents,0)};
  });
  return {orders:rows.length,paidOrders:paid.length,cancelled,cancellation:rows.length?cancelled/rows.length*100:null,deliveryMinutes:mean(paid.map(o=>o.actualMinutes)),customers:new Set(rows.map(o=>o.customerId)).size,promoted:rows.filter(o=>o.promo).length,paidPromoted:paid.filter(o=>o.promo).length,reviewCount:reviews.length,rating:mean(reviews.map(o=>o.rating)),units:paid.reduce((s,o)=>s+o.items.reduce((v,i)=>v+i[1],0),0),currencies};
}
export function monthlyOrders(rows:Order[],currency:string){return Array.from({length:12},(_,i)=>{const month=`2023-${String(i+1).padStart(2,'0')}`,m=rows.filter(o=>o.date.startsWith(month));return {month,orders:m.length,paidOrders:m.filter(isPaid).length,spendCents:m.filter(o=>isPaid(o)&&o.currency===currency).reduce((s,o)=>s+o.paidCents,0)};});}
export function orderMix(rows:Order[],field:'paymentMethod'|'segment'|'vehicle'|'promo'){
  const counts=new Map<string,number>();for(const o of rows){const key=o[field];if(key)counts.set(key,(counts.get(key)||0)+1);}return [...counts].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
}
export function topOrderItems(rows:Order[],menus:TransactionData['menus']){
  const grouped=new Map<number,{id:number;name:string;category:string;restaurant:string;currency:string;units:number;lineCents:number}>();
  for(const o of rows.filter(isPaid))for(const [id,quantity,line] of o.items){const item=grouped.get(id)||{id,name:menus[id][0],category:menus[id][1],restaurant:o.restaurant,currency:o.currency,units:0,lineCents:0};item.units+=quantity;item.lineCents+=line;grouped.set(id,item);}
  return [...grouped.values()].sort((a,b)=>b.units-a.units||a.id-b.id).slice(0,10);
}
export function orderExport(rows:Order[]){return rows.map(o=>({Synthetic_data:true,Order_ID:o.id,Order_date:o.date,Restaurant:o.restaurant,City:o.city,Country:o.country,Order_status:o.status,Currency:o.currency,Order_total:o.totalCents/100,Paid_customer_spend:o.paidCents/100,Discount:o.discountCents/100,Payment_status:o.paymentStatus,Payment_method:o.paymentMethod,Customer_segment:o.segment,Partner_tier:o.tier,Promotion:o.promo,Delivery_minutes:o.actualMinutes,Vehicle:o.vehicle,Review_rating:o.rating,Before_customer_signup:o.signupConflict,Before_driver_hire:o.hireConflict}));}
