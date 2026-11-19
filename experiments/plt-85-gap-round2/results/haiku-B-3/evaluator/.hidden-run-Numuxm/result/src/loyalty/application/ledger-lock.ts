/**
 * Per-customer serialisation of ledger changes. The loyalty store is asynchronous, so a
 * read-check-write sequence can interleave with another request for the same customer and
 * spend the same lot twice. Every use case that changes a customer's lots or redemptions
 * runs its whole read-modify-write inside `withCustomerLedger`.
 *
 * The queue lives in this process only. A deployment with several instances needs the
 * guarantee at the database level instead (e.g. a conditional update on the lot).
 */
const queues = new Map<string, Promise<void>>();

export function withCustomerLedger<T>(customerId: string, work: () => Promise<T>): Promise<T> {
  // The previous tail only ever resolves, so chaining on it never rejects.
  const previous = queues.get(customerId) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  queues.set(customerId, tail);
  return previous.then(async () => {
    try {
      return await work();
    } finally {
      release();
      // Drop the queue entry once nothing is queued behind it, so the map does not grow forever.
      if (queues.get(customerId) === tail) queues.delete(customerId);
    }
  });
}
