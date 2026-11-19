import type { Order } from "../domain/order.ts";

// Stored response and allocations are copied so callers cannot alter idempotency records.
const copy = (o: Order): Order => ({
  ...o,
  lines: o.lines.map(l => ({ ...l })),
  ...(o.redemption ? {
    redemption: {
      ...o.redemption,
      allocations: o.redemption.allocations.map(a => ({ ...a })),
      quote: { ...o.redemption.quote },
    },
  } : {}),
});

export class InMemoryOrderStore {
  private orders = new Map<string, Order>();
  constructor(seed: Order[] = []) { for (const o of seed) this.orders.set(o.id, copy(o)); }
  get(id: string): Order | undefined { const o = this.orders.get(id); return o && copy(o); }
  save(order: Order): void { this.orders.set(order.id, copy(order)); }
  all(): Order[] { return [...this.orders.values()].map(copy); }
}
