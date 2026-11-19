import type { Order } from "../domain/order.ts";

/** Deep copy, so callers cannot change stored orders (including a redemption's lots and dates) by mutation. */
const copy = (o: Order): Order => structuredClone(o);

export class InMemoryOrderStore {
  private orders = new Map<string, Order>();
  constructor(seed: Order[] = []) { for (const o of seed) this.orders.set(o.id, copy(o)); }
  get(id: string): Order | undefined { const o = this.orders.get(id); return o && copy(o); }
  save(order: Order): void { this.orders.set(order.id, copy(order)); }
  all(): Order[] { return [...this.orders.values()].map(copy); }
}
