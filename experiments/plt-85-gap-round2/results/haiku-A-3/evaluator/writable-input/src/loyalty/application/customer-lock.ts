/**
 * Serialises work per customer within this process. The loyalty store is asynchronous,
 * so read-check-write sequences on a customer's lots must not interleave.
 */
const queues = new Map<string, Promise<void>>();

export function withCustomerLock<T>(customerId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(customerId) ?? Promise.resolve();
  const result = previous.then(work);
  const tail = result.then(() => undefined, () => undefined);
  queues.set(customerId, tail);
  void tail.then(() => {
    if (queues.get(customerId) === tail) queues.delete(customerId);
  });
  return result;
}
