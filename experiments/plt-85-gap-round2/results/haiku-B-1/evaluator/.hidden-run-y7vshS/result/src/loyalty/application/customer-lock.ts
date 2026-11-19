/**
 * Serialises work per customer. The loyalty store is asynchronous, so two redemptions
 * for one customer could otherwise both read the same lot and spend the same points.
 * Every ledger write for a customer (redeem, release on cancel) runs through this.
 *
 * Process-local: it covers one running instance. Several instances would need the
 * guarantee in the ledger database itself (e.g. a conditional update on the lot).
 */
const queues = new Map<string, Promise<void>>();

export function withCustomerLock<T>(customerId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(customerId) ?? Promise.resolve();
  const run = previous.then(work);
  // The queue tail never rejects, so one failed job does not block the jobs behind it.
  const settled = run.then(() => undefined, () => undefined);
  queues.set(customerId, settled);
  void settled.then(() => {
    if (queues.get(customerId) === settled) queues.delete(customerId);
  });
  return run;
}
