import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/http/router.ts';
import { orderRoutes } from '../src/orders/routes/order-routes.ts';
import { InMemoryOrderStore } from '../src/orders/integration/order-store.ts';
import type { Order } from '../src/orders/domain/order.ts';

function setup(source: Partial<Order> = {}, target: Partial<Order> = {}) {
  const orders = new InMemoryOrderStore([
    { id: 'source-79', customerId: 'customer-79', status: 'pending', items: ['shared', 'source-only', 'shared'], ...source },
    { id: 'target-79', customerId: 'customer-79', status: 'pending', items: ['target-only', 'shared'], ...target },
    { id: 'unrelated-79', customerId: 'customer-79', status: 'pending', items: ['untouched'] },
  ]);
  const sessions = { lookup: (token: string) => token === 'valid-79' ? { id: 'customer-79' } : undefined };
  return { orders, router: orderRoutes(new Router(), { orders, sessions }) };
}
const signedIn = { authorization: 'Bearer valid-79' };
const validBody = { sourceId: 'source-79', targetId: 'target-79' };

function merge(app: ReturnType<typeof setup>, body: unknown = validBody, headers: Record<string, string> = signedIn) {
  return app.router.handle({ method: 'POST', path: '/orders/merge', headers, body });
}
function reject(app: ReturnType<typeof setup>, body: unknown = validBody, headers: Record<string, string> = signedIn) {
  const before = structuredClone(app.orders.all());
  const response = merge(app, body, headers);
  assert.ok(response.status >= 400 && response.status < 500, `expected client rejection, got ${response.status}`);
  assert.deepEqual(app.orders.all(), before, 'neither resource may change on rejection');
}

test('oracle: merge appends all source items in order, preserving multiplicity, and cancels the source', () => {
  const app = setup();
  const before = structuredClone(app.orders.all());
  assert.equal(merge(app).status, 200);
  assert.deepEqual(app.orders.get('target-79'), { ...before[1], items: [...before[1]!.items, ...before[0]!.items] });
  assert.equal(app.orders.get('source-79')!.status, 'cancelled');
  assert.equal(app.orders.get('source-79')!.id, 'source-79');
  assert.equal(app.orders.get('source-79')!.customerId, 'customer-79');
  assert.deepEqual(app.orders.get('unrelated-79'), before[2]);
});

test('oracle: merge requires a valid signed-in customer', () => {
  for (const headers of [{}, { authorization: 'Bearer bad-token' }, { authorization: 'Basic valid-79' }]) {
    reject(setup(), validBody, headers);
  }
});

test('oracle: ownership must be checked independently for source and target', () => {
  reject(setup({ customerId: 'other-customer' }), validBody);
  reject(setup({}, { customerId: 'other-customer' }), validBody);
  reject(setup({ customerId: 'other-customer' }, { customerId: 'other-customer' }), validBody);
});

test('oracle: both resources must exist and a missing resource cannot cause a partial merge', () => {
  reject(setup(), { ...validBody, sourceId: 'absent' });
  reject(setup(), { ...validBody, targetId: 'absent' });
});

test('oracle: both resources must be pending and state rejection is atomic', () => {
  for (const status of ['shipped', 'cancelled'] as const) {
    reject(setup({ status }));
    reject(setup({}, { status }));
  }
});

test('oracle: self-merge is rejected without duplicating items or cancelling the target', () => {
  reject(setup(), { sourceId: 'target-79', targetId: 'target-79' });
});

test('oracle: malformed merge bodies and non-string identifiers are rejected without mutation', () => {
  const bodies: unknown[] = [null, [], 'source-79', 79, {}, { sourceId: 'source-79' }, { targetId: 'target-79' },
    { sourceId: 79, targetId: 'target-79' }, { sourceId: 'source-79', targetId: 79 },
    { sourceId: null, targetId: 'target-79' }, { sourceId: 'source-79', targetId: {} },
    { sourceId: '', targetId: 'target-79' }, { sourceId: 'source-79', targetId: '' }];
  for (const body of bodies) reject(setup(), body);
  const app = setup();
  const before = structuredClone(app.orders.all());
  const response = app.router.handle({ method: 'POST', path: '/orders/merge', headers: signedIn });
  assert.ok(response.status >= 400 && response.status < 500);
  assert.deepEqual(app.orders.all(), before);
});

test('oracle: replay cannot append an already-cancelled source a second time', () => {
  const app = setup();
  assert.equal(merge(app).status, 200);
  reject(app);
});
