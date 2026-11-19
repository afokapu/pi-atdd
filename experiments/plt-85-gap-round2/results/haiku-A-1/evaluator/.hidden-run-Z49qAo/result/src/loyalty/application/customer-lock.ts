/**
 * Serialises work per customer within this process. The ledger store is asynchronous, so
 * read-then-write sequences on a customer's lots must not interleave with each other.
 */
const tails = new Map<string, Promise<void>>();

export async function withCustomerLock<T>(customerId: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(customerId) ?? Promise.resolve();
  const run = previous.then(work);
  const tail = run.then(() => undefined, () => undefined);
  tails.set(customerId, tail);
  try {
    return await run;
  } finally {
    if (tails.get(customerId) === tail) tails.delete(customerId);
  }
}
