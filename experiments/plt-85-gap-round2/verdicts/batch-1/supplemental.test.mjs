import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const root = '~/forge-evidence/pi-atdd/plt-85-evaluator-verdicts/batch-1';
const ids = ['r-06e5b0','r-18fc74','r-4112e4','r-517e45','r-7713e9','r-8c4084','r-d7208b','r-e1bdd8','r-e60b3c','r-f55914'];
for (const id of ids) {
  const result = JSON.parse(await readFile(`${root}/${id}/hidden-result.json`, 'utf8'));
  const dir = `${result.run.workDirectory}/result`;
  const imp = p => import(pathToFileURL(`${dir}/${p}`));
  const { createApp } = await imp('src/app.ts');
  const { InMemoryOrderStore } = await imp('src/orders/integration/order-store.ts');
  const { InMemoryLoyaltyStore } = await imp('src/loyalty/integration/loyalty-store.ts');
  const { YieldingStore } = await imp('evaluator-hidden/store-counter.ts');
  const { configureTaxRates } = await imp('src/pricing/integration/tax-rates.ts');
  const start = Date.parse('2042-04-10T12:00:00Z');
  const seedOrder = (oid='one') => ({id:oid, customerId:'alice', status:'pending', region:'DE', lines:[{sku:'x',unitPriceCents:10005,quantity:1}]});
  const sessions = {lookup: () => ({id:'alice'})};
  const headers = {authorization:'Bearer token'};
  const req = (router, oid, points, key) => router.handle({method:'POST',path:`/orders/${oid}/redeem`,headers,body:{points,idempotencyKey:key}});
  const point = body => body.pointsAppliedCents ?? body.pointsCents;
  test(`${id}: supplemental yielding race ledger conservation, without GET quote precondition`, async t => {
    t.mock.timers.enable({apis:['Date'], now:start});
    configureTaxRates({DE:0.19,FR:0.2,US:0});
    const seed = Array.from({length:7},(_,i)=>({id:`lot-${i}`,customerId:'alice',points:73+i*29,expiresAt:new Date(start+(i+1)*86400000)}));
    const initial = seed.reduce((a,l)=>a+l.points,0);
    const loyalty = new YieldingStore(seed);
    const router = createApp({orders:new InMemoryOrderStore(Array.from({length:20},(_,i)=>seedOrder(`o${i}`))),loyalty,sessions,now:()=>new Date(start)});
    const rs = await Promise.all(Array.from({length:20},(_,i)=>req(router,`o${i}`,211,`k${i}`)));
    const used = rs.reduce((s,r)=>s+(r.status===200?point(r.body):0),0);
    const after = await loyalty.lotsFor('alice');
    assert.ok(after.every(l=>l.points>=0));
    assert.ok(used>0 && used<=initial);
    assert.equal(used,initial-after.reduce((s,l)=>s+l.points,0));
  });
  if (id === 'r-4112e4') test(`${id}: supplemental simultaneous cancellations restore once`, async t => {
    t.mock.timers.enable({apis:['Date'], now:start});
    const loyalty = new YieldingStore([{id:'a',customerId:'alice',points:500,expiresAt:new Date(start+86400000)}]);
    const router=createApp({orders:new InMemoryOrderStore([seedOrder()]),loyalty,sessions,now:()=>new Date(start)});
    assert.equal((await req(router,'one',200,'first')).status,200);
    await Promise.all([1,2].map(()=>router.handle({method:'POST',path:'/orders/one/cancel',headers})));
    assert.equal((await loyalty.getLot('a')).points,500);
  });
}
