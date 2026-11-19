import { InMemoryLoyaltyStore } from "../src/loyalty/integration/loyalty-store.ts";
import type { PointsLot } from "../src/loyalty/domain/points.ts";
import { setImmediate as immediate } from "node:timers/promises";

/** Count lot-shaped records across arbitrary added single/bulk methods, including
 * nested envelopes, Maps and Sets. No dependence on a product method's name.
 * Distinct occurrences in different calls count again (real repeated I/O).
 */
function records(value: unknown, seen = new Set<object>()): number {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  const x: any = value;
  // Include lean projections and patch writes such as { id, points } or
  // saveLot(id, { points }), not just the full base PointsLot shape.
  const own = typeof x.points === "number" && (typeof x.id === "string" ||
    x.expiresAt !== undefined || typeof x.customerId === "string" || Object.keys(x).length === 1) ? 1 : 0;
  let result: number;
  if (value instanceof Map) result = [...value.values()].reduce((n, v) => n + records(v, seen), 0);
  else if (value instanceof Set || Array.isArray(value)) result = [...value].reduce((n, v) => n + records(v, seen), 0);
  else result = own + Object.values(value).reduce<number>((n, v) => n + records(v, seen), 0);
  seen.delete(value); // A repeated record in two array slots is two records.
  return result;
}

/** Delays surround base reads/writes; no fake scheduler or mocked I/O timers.
 * The result-side delay also applies to added asynchronous store methods.
 */
export class YieldingStore extends InMemoryLoyaltyStore {
  async lotsFor(id: string) { await immediate(); const r = await super.lotsFor(id); await immediate(); return r; }
  async getLot(id: string) { await immediate(); const r = await super.getLot(id); await immediate(); return r; }
  async saveLot(lot: PointsLot) { await immediate(); await super.saveLot(lot); await immediate(); }
}

export function instrumentStore(target: InMemoryLoyaltyStore, yielding = false) {
  let calls: Record<string, number> = {}, lotsRead = 0, lotsWritten = 0;
  const wrapped = new WeakSet<Function>();
  function wrap(key: PropertyKey, fn: Function) {
    if (wrapped.has(fn)) return fn;
    const method = String(key);
    const wrapper = function (...args: unknown[]) {
      calls[method] = (calls[method] ?? 0) + 1;
      lotsWritten += records(args);
      const observe = (result: any): any => {
        lotsRead += records(result);
        // Also see added streaming queries. Preserve the iterator receiver.
        if (result && !Array.isArray(result) && !(result instanceof Map) && !(result instanceof Set)) {
          if (typeof result[Symbol.asyncIterator] === "function") return (async function* () {
            for await (const value of result) { lotsRead += records(value); yield value; }
          })();
          if (typeof result !== "string" && typeof result[Symbol.iterator] === "function") return (function* () {
            for (const value of result) { lotsRead += records(value); yield value; }
          })();
        }
        return result;
      };
      const result = Reflect.apply(fn, target, args);
      if (result && typeof result.then === "function") {
        return result.then(async (r: unknown) => { if (yielding) await immediate(); return observe(r); });
      }
      return observe(result);
    };
    wrapped.add(wrapper);
    return wrapper;
  }
  // Install on the receiver too: this.method() calls cannot evade the counter.
  // Preserve the original receiver for JS #private fields.
  const seen = new Set<PropertyKey>();
  for (let p: any = target; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Reflect.ownKeys(p)) {
      if (key === "constructor" || seen.has(key)) continue;
      seen.add(key);
      const d = Object.getOwnPropertyDescriptor(p, key);
      if (typeof d?.value === "function") Object.defineProperty(target, key, {
        configurable: true, writable: true, value: wrap(key, d.value),
      });
    }
  }
  const store = new Proxy(target, {
    get(t, key) {
      const value = Reflect.get(t, key, t);
      return typeof value === "function" && key !== "constructor" ? wrap(key, value) : value;
    },
  });
  return {
    store,
    reset() { calls = {}; lotsRead = 0; lotsWritten = 0; },
    snapshot() { return { methods: { ...calls }, total: Object.values(calls).reduce((a, b) => a + b, 0), lotsRead, lotsWritten, records: lotsRead + lotsWritten }; },
  };
}
export function countedStore(seed: PointsLot[], yielding = false) {
  return instrumentStore(yielding ? new YieldingStore(seed) : new InMemoryLoyaltyStore(seed), yielding);
}
