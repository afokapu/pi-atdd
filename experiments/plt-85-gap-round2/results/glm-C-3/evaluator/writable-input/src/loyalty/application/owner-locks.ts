/**
 * Per-key asynchronous mutex. The application's stores are asynchronous (each
 * call yields to the event loop), so a read-decide-write spread over awaits
 * would interleave; every mutation of one owner's points therefore runs inside
 * `locks.run(ownerKey, ...)` — the substitute for a database row lock.
 */
export class OwnerLocks {
  /** Last scheduled section per key; chaining keeps sections strictly sequential. */
  private tails = new Map<string, Promise<unknown>>();

  /** Run `fn` as the next critical section for `key`; callers for the same key queue up. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(key) ?? Promise.resolve();
    // Start fn regardless of how the previous section ended, and keep the chain
    // alive by storing a swallowed version of this section's outcome.
    const result = tail.then(fn, fn);
    this.tails.set(key, result.catch(() => undefined));
    return result;
  }
}

/** Lock key grouping everything that can move one customer's points balance. */
export function customerLockKey(customerId: string): string {
  return "customer:" + customerId;
}
