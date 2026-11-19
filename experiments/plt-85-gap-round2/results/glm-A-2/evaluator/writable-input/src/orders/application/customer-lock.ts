/**
 * In-process mutex per customer. Serializes read-modify-write sequences over
 * the (asynchronous) ledger so that concurrent requests of one customer can
 * never spend or refund the same points. The customer id is the natural lock
 * key: points lots belong to exactly one customer.
 */
export class CustomerLocks {
  private tails = new Map<string, Promise<unknown>>();

  /** Run `fn` while holding the customer's lock; other callers queue up. */
  runExclusive<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(customerId) ?? Promise.resolve();
    const result = prev.catch(() => {}).then(fn);
    // Remember only the settled tail so a failing fn cannot poison the queue.
    this.tails.set(customerId, result.catch(() => {}));
    return result;
  }
}
