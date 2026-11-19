import type { Order } from "../domain/order.ts";

const copy = (o: Order): Order => ({
  ...o,
  lines: o.lines.map(l => ({ ...l })),
  ...(o.redemption ? { redemption: { points: o.redemption.points, lots: o.redemption.lots.map(x => ({ ...x })) } } : {}),
});

export class InMemoryOrderStore {
  private orders = new Map<string, Order>();
  constructor(seed: Order[] = []) { for (const o of seed) this.orders.set(o.id, copy(o)); }
  get(id: string): Order | undefined { const o = this.orders.get(id); return o && copy(o); }
  save(order: Order): void { this.orders.set(order.id, copy(order)); }
  all(): Order[] { return [...this.orders.values()].map(copy); }
}
