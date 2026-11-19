import { pathToFileURL } from 'node:url';
const [id, root] = process.argv.slice(2);
const imp = p => import(pathToFileURL(root + '/src/' + p));
const { createApp } = await imp('app.ts');
const { InMemoryOrderStore } = await imp('orders/integration/order-store.ts');
const { InMemoryLoyaltyStore } = await imp('loyalty/integration/loyalty-store.ts');
const { configureTaxRates } = await imp('pricing/integration/tax-rates.ts');
const at = new Date('2042-04-10T12:00:00Z');
const headers = { authorization: 'Bearer alice' };
function fixture() {
  configureTaxRates({ DE: 0.19 });
  const orders = new InMemoryOrderStore([{id:'o',customerId:'alice',status:'pending',region:'DE',lines:[{sku:'x',unitPriceCents:1000,quantity:1}]}]);
  const loyalty = new InMemoryLoyaltyStore([{id:'lot',customerId:'alice',points:1000,expiresAt:new Date('2043-01-01')}]);
  const app = createApp({orders,loyalty,now:()=>at,sessions:{lookup:t=>t==='alice'?{id:'alice'}:undefined}});
  return {orders,loyalty,redeem:(key='k')=>app.handle({method:'POST',path:'/orders/o/redeem',headers,body:{points:200,idempotencyKey:key}}),cancel:()=>app.handle({method:'POST',path:'/orders/o/cancel',headers}),balance:async()=>(await loyalty.getLot('lot')).points};
}
const safe = async fn => { try { return await fn(); } catch(e) { return {error:e.constructor.name,message:e.message}; } };
const results = {id};
{
  const f=fixture(); const first=await f.redeem(); configureTaxRates({DE:0.25}); const replay=await f.redeem();
  results.taxReplay={first,replay,identical:JSON.stringify(first)===JSON.stringify(replay),balance:await f.balance()};
}
{
  const f=fixture(); await f.redeem(); f.orders.save({...f.orders.get('o'),customerId:'bob'}); const replay=await f.redeem();
  results.replayOwnership={replay,rejected:[403,404].includes(replay.status)};
}
for (const which of ['redeemThenCancel','cancelThenRedeem']) {
  const f=fixture(); const responses=await Promise.all(which==='redeemThenCancel'?[f.redeem(),f.cancel()]:[f.cancel(),f.redeem()]);
  results[which]={responses,order:f.orders.get('o'),balance:await f.balance()};
}
{
  const f=fixture(); await f.redeem(); const responses=await Promise.all([f.cancel(),f.cancel()]);
  results.concurrentCancels={responses,order:f.orders.get('o'),balance:await f.balance()};
}
{
  const f=fixture(); const responses=await Promise.all([f.redeem(),f.redeem()]);
  results.concurrentReplay={responses,order:f.orders.get('o'),balance:await f.balance()};
}
{
  const f=fixture(); configureTaxRates({}); const response=await safe(()=>f.redeem());
  results.unavailableTaxConfiguration={response,balance:await f.balance(),order:f.orders.get('o')};
}
{
  // Deterministically model the documented operations hook changing rates during
  // ledger I/O. Delegate to the unmodified real adapter, then replace tax config
  // before its promise returns to the workflow. No store failure is injected.
  const f=fixture(); const method=typeof f.loyalty.redeem==='function'?'redeem':'saveLot';
  const original=f.loyalty[method].bind(f.loyalty);
  f.loyalty[method]=async(...args)=>{const result=await original(...args);configureTaxRates({});return result;};
  const response=await safe(()=>f.redeem()); const afterRequest={balance:await f.balance(),order:f.orders.get('o')};
  f.loyalty[method]=original; configureTaxRates({DE:0.19});
  const cancellation=await safe(()=>f.cancel());
  results.taxRemovedDuringIO={method,response,afterRequest,cancellation,afterCancel:{balance:await f.balance(),order:f.orders.get('o')}};
}
console.log(JSON.stringify(results,null,2));
