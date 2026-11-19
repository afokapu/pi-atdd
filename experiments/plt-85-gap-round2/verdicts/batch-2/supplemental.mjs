import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const root = '~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/batch-2';
const ids = ['r-0e2a35','r-1a5cc8','r-2b7afa','r-2d7791','r-389a5e','r-4e064f','r-59f404','r-7c9b86','r-ae736d','r-afbc49'];
const result = {};
for (const id of ids) {
 const load = p => import(pathToFileURL(`${root}/${id}/writable-input/src/${p}`).href);
 const {createApp} = await load('app.ts');
 const {InMemoryOrderStore} = await load('orders/integration/order-store.ts');
 const {InMemoryLoyaltyStore} = await load('loyalty/integration/loyalty-store.ts');
 const seedOrder = id => ({id,customerId:'alice',status:'pending',region:'DE',lines:[{sku:'x',unitPriceCents:10005,quantity:1}]});
 const fixture = () => {
  const orders = new InMemoryOrderStore([seedOrder('one'),seedOrder('two')]);
  const loyalty = new InMemoryLoyaltyStore([{id:'a',customerId:'alice',points:500,expiresAt:new Date('2043-01-01')}]);
  const router = createApp({orders,loyalty,sessions:{lookup:t=>({id:t})},now:()=>new Date('2042-04-10')});
  const redeem = (order,key,points=400) => router.handle({method:'POST',path:`/orders/${order}/redeem`,headers:{authorization:'Bearer alice'},body:{points,idempotencyKey:key}});
  return {orders,loyalty,router,redeem};
 };
 let f=fixture();
 const rs=await Promise.all([f.redeem('one','a'),f.redeem('two','b')]);
 const after=await f.loyalty.lotsFor('alice');
 result[id]={twoOrderProbe:{responses:rs,actualRemoved:500-after.reduce((n,l)=>n+l.points,0)}};
 f=fixture();
 await f.redeem('one','private',100);
 f.orders.save({...f.orders.get('one'),customerId:'bob'});
 result[id].replayAfterOwnershipChange=await f.redeem('one','private',100);
 if(id==='r-389a5e') {
  f=fixture();
  const redeem=f.redeem('one','cancel-race',100);
  const cancel=f.router.handle({method:'POST',path:'/orders/one/cancel',headers:{authorization:'Bearer alice'}});
  result[id].cancelRace={responses:await Promise.all([redeem,cancel]),order:f.orders.get('one'),lots:await f.loyalty.lotsFor('alice')};
 }
}
await writeFile(`${root}/supplemental-result.json`,JSON.stringify(result,null,2)+'\n');
