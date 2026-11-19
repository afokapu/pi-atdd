import type { Order } from "../domain/order.ts";

const copy = (o: Order): Order => ({ ...o, lines: o.lines.map(l => ({ ...l })) });

export class InMemoryOrderStore {
  private orders = new Map<string, Order>();
  private locks = new Map<string, Promise<void>>();
  constructor(seed: Order[] = []) { for (const o of seed) this.orders.set(o.id, copy(o)); }
  get(id: string): Order | undefined { const o = this.orders.get(id); return o && copy(o); }
  save(order: Order): void { this.orders.set(order.id, copy(order)); }
  all(): Order[] { return [...this.orders.values()].map(copy); }

  /** Keep state transitions for one order together across asynchronous ledger calls. */
  async exclusively<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id);
    let release: () => void = () => undefined;
    const own = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(id, own);
    await previous;
    try { return await action(); }
    finally {
      release();
      if (this.locks.get(id) === own) this.locks.delete(id);
    }
  }
}
