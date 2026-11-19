// Uncounted calibration probe: delay the existing customer queue, then advance
// deps.now to the source lot's expiry before releasing the queued operation.
// Submitted files are imported read-only and never modified.
import { pathToFileURL } from 'node:url';
const root = '~/forge-evidence/pi-atdd/plt-85-evaluator-work';
const cases = [
  ['batch-1', 'r-8c4084', 'customerLocks'],
  ['batch-1', 'r-e60b3c', null],
  ['batch-2', 'r-0e2a35', 'customerTails'],
  ['batch-2', 'r-389a5e', 'customerLocks'],
  ['batch-3', 'r-8403c2', 'transactionTail'],
];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const results = [];
for (const [batch, id, queue] of cases) {
  const load = p => import(pathToFileURL(`${root}/${batch}/${id}/tree/src/${p}.ts`).href);
  const { createApp } = await load('app');
  const { InMemoryOrderStore } = await load('orders/integration/order-store');
  const { InMemoryLoyaltyStore } = await load('loyalty/integration/loyalty-store');
  let serviceClass, originalEnqueue;
  if (!queue) {
    serviceClass = (await load('loyalty/application/redeem-service')).RedeemService;
    originalEnqueue = serviceClass.prototype.enqueue;
  }
  for (const mode of ['debit', 'refund']) {
    const expiry = Date.parse('2042-05-02T00:00:00Z');
    let clock = expiry - 1000;
    let sampled;
    const loyalty = new InMemoryLoyaltyStore([{ id: 'lot', customerId: 'alice', points: 100, expiresAt: new Date(expiry) }]);
    const orders = new InMemoryOrderStore([{ id: 'o', customerId: 'alice', status: 'pending', region: 'DE', lines: [{ sku: 'x', unitPriceCents: 1000, quantity: 1 }] }]);
    const app = createApp({ loyalty, orders, sessions: { lookup: () => ({ id: 'alice' }) }, now: () => { sampled?.resolve(); return new Date(clock); } });
    const request = (action) => app.handle({ method: 'POST', path: `/orders/o/${action}`, headers: { authorization: 'Bearer a' }, body: { points: 50, idempotencyKey: 'key' } });
    let initial;
    if (mode === 'refund') {
      initial = await request('redeem');
      if (initial.status !== 200) throw new Error(`${id} positive control failed`);
    }
    const gate = deferred();
    sampled = deferred();
    if (queue === 'transactionTail') loyalty[queue] = gate.promise;
    else if (queue) loyalty[queue].set('alice', gate.promise);
    else serviceClass.prototype.enqueue = function(customerId, task) {
      return originalEnqueue.call(this, customerId, async () => { await gate.promise; return task(); });
    };
    const pending = request(mode === 'debit' ? 'redeem' : 'cancel');
    await sampled.promise;
    clock = expiry;
    gate.resolve();
    const response = await pending;
    if (!queue) serviceClass.prototype.enqueue = originalEnqueue;
    const lots = await loyalty.lotsFor('alice');
    results.push({ id, mode, status: response.status, balanceAtExpiry: lots[0].points,
      expectedBalanceAtExpiry: mode === 'debit' ? 100 : 50,
      response: response.body });
  }
}
console.log(JSON.stringify({ counted: false, results }, null, 2));
