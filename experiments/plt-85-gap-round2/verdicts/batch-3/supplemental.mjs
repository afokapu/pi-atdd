// Supplemental evidence only; never part of the frozen 33-case denominator.
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const [tree, output] = process.argv.slice(2);
const load = p => import(pathToFileURL(`${tree}/${p}`).href);
const { createApp } = await load('src/app.ts');
const { InMemoryOrderStore } = await load('src/orders/integration/order-store.ts');
const { InMemoryLoyaltyStore } = await load('src/loyalty/integration/loyalty-store.ts');
const { YieldingStore } = await load('evaluator-hidden/store-counter.ts');
const START = Date.parse('2042-04-10T12:00:00Z'), DAY = 86400000;
const order = id => ({ id, customerId: 'alice', status: 'pending', region: 'DE', lines: [{ sku: 'item', unitPriceCents: 10005, quantity: 1 }] });
const lot = (id, points, i = 1) => ({ id, customerId: 'alice', points, expiresAt: new Date(START + i * DAY) });
const sessions = { lookup: token => token === 'alice' ? { id: 'alice' } : token === 'bob' ? { id: 'bob' } : undefined };
function fixture(orders, ledger) {
 const router = createApp({ orders, loyalty: ledger, sessions, now: () => new Date(START) });
 return (id, points, key) => router.handle({ method: 'POST', path: `/orders/${id}/redeem`, headers: { authorization: 'Bearer alice' }, body: { points, idempotencyKey: key } });
}
const applied = r => r.body.pointsAppliedCents ?? r.body.pointsCents ?? r.body.pointsApplied;
const result = { note: 'Supplemental probes, not counted hidden tests.', conservation: [] };
for (const [count, seed, request] of [[2, [lot('a', 500)], 400], [6, [lot('a',101),lot('b',203,2),lot('c',307,3)],250], [12,[lot('a',1000)],137], [20,Array.from({length:7},(_,i)=>lot(`l${i}`,73+i*29,i+1)),211]]) {
 const ledger = new YieldingStore(seed), orders = new InMemoryOrderStore(Array.from({length:count},(_,i)=>order(`o${i}`)));
 const redeem = fixture(orders,ledger), rs = await Promise.all(Array.from({length:count},(_,i)=>redeem(`o${i}`,request,`k${i}`)));
 const sum = rs.filter(r=>r.status>=200 && r.status<300).reduce((s,r)=>s+applied(r),0);
 const after = await ledger.lotsFor('alice'), delta = seed.reduce((s,l)=>s+l.points,0)-after.reduce((s,l)=>s+l.points,0);
 result.conservation.push({ count, sumApplied: sum, ledgerReduction: delta, nonnegative: after.every(l=>l.points>=0), conserved: sum === delta, statuses: rs.map(r=>r.status) });
}
{
 const orders = new InMemoryOrderStore([order('o')]), ledger = new InMemoryLoyaltyStore([lot('a',1000)]), redeem = fixture(orders,ledger);
 await redeem('o',100,'key'); orders.save({...orders.get('o'), customerId:'bob'});
 result.replayAfterOwnershipChange = await redeem('o',100,'key');
}
{
 const seed = [lot('a',81),lot('b',123,2),lot('c',500,3)];
 class FailSecondWrite extends InMemoryLoyaltyStore {
  writes = 0;
  async saveLot(l) { if (++this.writes === 2) throw new Error('supplemental one-shot write fault'); return super.saveLot(l); }
 }
 const ledger = new FailSecondWrite(seed), orders = new InMemoryOrderStore([order('o'),order('recovery')]), redeem = fixture(orders,ledger);
 let outcome; try { outcome = await redeem('o',300,'fault'); } catch (e) { outcome = {error:e.message}; }
 result.secondLotWriteFault = { outcome, writes:ledger.writes, before:seed, after:await ledger.lotsFor('alice') };
 try { result.secondLotWriteFault.recovery = await redeem('recovery',20,'recovery'); } catch (e) { result.secondLotWriteFault.recovery = {error:e.message}; }
}
{
 class FailOrderSave extends InMemoryOrderStore { save() { throw new Error('supplemental publication fault'); } }
 const seed = [lot('a',81),lot('b',123,2),lot('c',500,3)], ledger = new InMemoryLoyaltyStore(seed);
 const orders = new FailOrderSave([order('o')]), redeem = fixture(orders,ledger);
 let outcome; try { outcome = await redeem('o',300,'publish'); } catch (e) { outcome = {error:e.message}; }
 result.orderPublicationFault = { outcome, before:seed, after:await ledger.lotsFor('alice') };
}
await writeFile(output, JSON.stringify(result,null,2)+'\n');
