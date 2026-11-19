/**
 * Per-key critical sections for asynchronous read-check-write sequences.
 * Callbacks for the same key run one after another in arrival order; different keys do not wait
 * on each other. The lock lives in one process only: it serialises callers of this app instance.
 * A failing callback releases the key, so one error never blocks later callers.
 */
export class KeyedLock {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, critical: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    try {
      await previous;
      return await critical();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
