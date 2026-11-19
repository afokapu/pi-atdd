/**
 * Serialises ledger work per customer so concurrent requests never read the same
 * lot balance and spend it twice. In-process only: with several service instances
 * the ledger database must provide this (row locks / conditional writes).
 */
export class CustomerLock {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(customerId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(customerId) ?? Promise.resolve();
    const next = prev.then(work, work);
    const tail = next.catch(() => undefined);
    this.tails.set(customerId, tail);
    tail.then(() => { if (this.tails.get(customerId) === tail) this.tails.delete(customerId); });
    return next;
  }
}
