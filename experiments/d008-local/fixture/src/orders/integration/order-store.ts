import type { Order } from "../domain/order.ts";

export class InMemoryOrderStore {
  private orders = new Map<string, Order>();
  constructor(seed: Order[] = []) { for (const o of seed) this.orders.set(o.id, { ...o }); }
  get(id: string): Order | undefined { const o = this.orders.get(id); return o && { ...o }; }
  save(order: Order): void { this.orders.set(order.id, { ...order }); }
  all(): Order[] { return [...this.orders.values()].map(o => ({ ...o })); }
}
