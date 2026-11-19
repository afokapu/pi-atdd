/**
 * Serialises asynchronous operations per key (e.g. per customer), so a
 * read-decide-write sequence against a shared async store cannot interleave:
 * while one operation runs for a key, every other operation for the same key
 * queues behind it. Operations for different keys run concurrently.
 */
export class PerKeyLock {
  /** Last settled (failure-swallowed) operation per key; the queue tail. */
  private tails = new Map<string, Promise<void>>();

  /** Run `op` exclusively among operations for `key`; resolves/rejects with op's outcome. */
  run<T>(key: string, op: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(op);
    // The tail must never reject, or every queued operation for the key would stall.
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    // Forget the tail once it settles last, so the map does not grow with stale keys.
    tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }
}
