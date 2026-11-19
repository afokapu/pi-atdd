/**
 * Serializes asynchronous critical sections per key (e.g. per customer), so that
 * read-modify-write cycles on an asynchronous store cannot interleave.
 * Different keys run concurrently.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  run<T>(key: string, section: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(section);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
