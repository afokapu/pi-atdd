import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [id, root] = process.argv.slice(2);
const imp = p => import(pathToFileURL(root + '/src/' + p));
const { createApp } = await imp('app.ts');
const { InMemoryOrderStore } = await imp('orders/integration/order-store.ts');
const { InMemoryLoyaltyStore } = await imp('loyalty/integration/loyalty-store.ts');
const { configureTaxRates } = await imp('pricing/integration/tax-rates.ts');
const at = new Date('2042-04-10T12:00:00Z');
const headers = { authorization: 'Bearer alice' };
function fixture(extra = {}) {
  configureTaxRates({ DE: 0.19 });
  const orders = new InMemoryOrderStore([{id:'o', customerId:'alice',status:'pending',region:'DE',lines:[{sku:'x',unitPriceCents:1000,quantity:1}],...extra}]);
  const loyalty = new InMemoryLoyaltyStore([{id:'lot',customerId:'alice',points:1000,expiresAt:new Date('2043-01-01')}]);
  const app = createApp({orders,loyalty,now:()=>at,sessions:{lookup:t=>t==='alice'?{id:'alice'}:undefined}});
  return { orders, loyalty, redeem:(key='k')=>app.handle({method:'POST',path:'/orders/o/redeem',headers,body:{points:200,idempotencyKey:key}}), cancel:()=>app.handle({method:'POST',path:'/orders/o/cancel',headers}), balance:async()=>(await loyalty.getLot('lot')).points };
}
const results = {id};
{
  const f = fixture(); const first = await f.redeem(); configureTaxRates({DE:0.25}); const replay = await f.redeem();
  results.taxReplay = {first,replay,identical:JSON.stringify(first)===JSON.stringify(replay),balance:await f.balance()};
}
{
  const f = fixture(); await f.redeem(); f.orders.save({...f.orders.get('o'),customerId:'bob'}); const replay=await f.redeem();
  results.replayOwnership = {replay, rejected:[403,404].includes(replay.status)};
}
{
  const f = fixture(); const redeem = f.redeem(); const cancel = f.cancel();
  results.redeemThenCancel = {responses:await Promise.all([redeem,cancel]),order:f.orders.get('o'),balance:await f.balance()};
}
{
  const f = fixture(); const cancel = f.cancel(); const redeem = f.redeem();
  results.cancelThenRedeem = {responses:await Promise.all([cancel,redeem]),order:f.orders.get('o'),balance:await f.balance()};
}
{
  const f = fixture(); await f.redeem(); const responses=await Promise.all([f.cancel(),f.cancel()]);
  results.concurrentCancels={responses,order:f.orders.get('o'),balance:await f.balance()};
}
{
  const f = fixture(); const responses=await Promise.all([f.redeem(),f.redeem()]);
  results.concurrentReplay={responses,order:f.orders.get('o'),balance:await f.balance()};
}
{
  const f = fixture(); configureTaxRates({});
  let response; try { response = await f.redeem(); } catch (e) { response = {error:e.constructor.name,message:e.message}; }
  results.unavailableTaxConfiguration = {response,balance:await f.balance(),order:f.orders.get('o')};
}
console.log(JSON.stringify(results,null,2));
