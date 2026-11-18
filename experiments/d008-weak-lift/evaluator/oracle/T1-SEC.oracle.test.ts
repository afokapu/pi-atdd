import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/http/router.ts';
import { orderRoutes } from '../src/orders/routes/order-routes.ts';
import { InMemoryOrderStore } from '../src/orders/integration/order-store.ts';
import type { Order } from '../src/orders/domain/order.ts';

function setup(status: Order['status'] = 'pending', owner = 'customer-79') {
  const orders = new InMemoryOrderStore([
    { id: 'cancel-79', customerId: owner, status, items: ['red', 'red', 'blue'] },
    { id: 'untouched', customerId: 'customer-79', status: 'pending', items: ['other'] },
  ]);
  const sessions = { lookup: (token: string) => token === 'valid-79' ? { id: 'customer-79' } : undefined };
  return { orders, router: orderRoutes(new Router(), { orders, sessions }) };
}
const signedIn = { authorization: 'Bearer valid-79' };

function rejectedWithoutChange(app: ReturnType<typeof setup>, headers: Record<string, string>, path = '/orders/cancel-79/cancel') {
  const before = structuredClone(app.orders.all());
  const response = app.router.handle({ method: 'POST', path, headers });
  assert.ok(response.status >= 400 && response.status < 500, `expected client rejection, got ${response.status}`);
  assert.deepEqual(app.orders.all(), before, 'rejection must not mutate stored orders');
}

test('oracle: cancellation persists for the authenticated owner and preserves unrelated data', () => {
  const app = setup();
  const before = structuredClone(app.orders.all());
  const response = app.router.handle({ method: 'POST', path: '/orders/cancel-79/cancel', headers: signedIn });
  assert.equal(response.status, 200);
  assert.deepEqual(app.orders.get('cancel-79'), { ...before[0], status: 'cancelled' });
  assert.deepEqual(app.orders.get('untouched'), before[1]);
});

test('oracle: missing, invalid and non-Bearer credentials cannot cancel an order', () => {
  for (const headers of [{}, { authorization: 'Bearer invalid' }, { authorization: 'Basic valid-79' }]) {
    rejectedWithoutChange(setup(), headers);
  }
});

test('oracle: another customer cannot cancel the referenced order', () => {
  rejectedWithoutChange(setup('pending', 'someone-else'), signedIn);
});

test('oracle: shipped and cancelled orders reject cancellation without side effects', () => {
  for (const status of ['shipped', 'cancelled'] as const) rejectedWithoutChange(setup(status), signedIn);
});

test('oracle: a missing order is rejected without changing any existing order', () => {
  rejectedWithoutChange(setup(), signedIn, '/orders/missing-79/cancel');
});

test('oracle: a second cancellation is rejected and cannot change the cancelled order', () => {
  const app = setup();
  assert.equal(app.router.handle({ method: 'POST', path: '/orders/cancel-79/cancel', headers: signedIn }).status, 200);
  rejectedWithoutChange(app, signedIn);
});
