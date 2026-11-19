/**
 * Per-customer critical sections for the loyalty ledger. Every ledger call yields to
 * the event loop, so a read-decide-write sequence (redeem, cancel) can interleave with
 * another request for the same customer and spend the same points twice. Tasks for one
 * customer run strictly one after another; different customers run independently.
 */
export class CustomerLock {
  private tails = new Map<string, Promise<void>>();

  run<T>(customerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(customerId) ?? Promise.resolve();
    const current = previous.then(task);
    // The tail never rejects, so one failed task does not block the queue behind it.
    const tail = current.then(() => undefined, () => undefined);
    this.tails.set(customerId, tail);
    void tail.then(() => {
      if (this.tails.get(customerId) === tail) this.tails.delete(customerId);
    });
    return current;
  }
}
