import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipOrder } from '../src/shipping/domain/shipment.ts';
import type { Order } from '../src/orders/domain/order.ts';

test('oracle: a cancelled order is rejected with an error and remains cancelled with all data intact', () => {
  const order: Order = { id: 'cancelled-79', customerId: 'owner-79', status: 'cancelled', items: ['parcel-a', 'parcel-b'] };
  const before = structuredClone(order);
  assert.throws(() => shipOrder(order), Error);
  assert.deepEqual(order, before);
});

test('oracle: cancelled-order rejection is independent of identifiers and is safe to repeat', () => {
  for (const id of ['o9', 'other-cancelled-79']) {
    const order: Order = { id, customerId: 'another-owner', status: 'cancelled', items: [] };
    const before = structuredClone(order);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => shipOrder(order), Error);
      assert.deepEqual(order, before);
    }
  }
});

test('oracle: the cancellation guard does not prevent shipping an ordinary pending order', () => {
  const order: Order = { id: 'pending-79', customerId: 'owner-79', status: 'pending', items: ['parcel'] };
  const result = shipOrder(order);
  assert.equal(result.status, 'shipped');
  assert.equal(result.id, 'pending-79');
  assert.equal(result.customerId, 'owner-79');
  assert.deepEqual(result.items, ['parcel']);
});
