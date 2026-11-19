import { InMemoryLoyaltyStore } from "../src/loyalty/integration/loyalty-store.ts";
import type { PointsLot } from "../src/loyalty/domain/points.ts";

/** Instruments existing AND added methods without replacing the product's store.
 * Wrappers run with the original receiver (also supports JS #private fields).
 * Installed prototype wrappers count calls made by other store methods too.
 * Measurements only: tests never assert a call-count threshold.
 */
export function countedStore(seed: PointsLot[]) {
  const target = new InMemoryLoyaltyStore(seed);
  let calls: Record<string, number> = {};
  let lotsRead = 0, lotsWritten = 0;
  const wrapped = new WeakSet<Function>();
  function wrap(key: PropertyKey, fn: Function) {
    if (wrapped.has(fn)) return fn;
    const method = String(key);
    const wrapper = function (...args: unknown[]) {
      calls[method] = (calls[method] ?? 0) + 1;
      if (method === "saveLot") lotsWritten++;
      const observe = (result: any) => {
        if (method === "lotsFor" && Array.isArray(result)) lotsRead += result.length;
        if (method === "getLot" && result) lotsRead++;
        return result;
      };
      const result = Reflect.apply(fn, target, args);
      return result && typeof result.then === "function" ? result.then(observe) : observe(result);
    };
    wrapped.add(wrapper);
    return wrapper;
  }
  const seen = new Set<PropertyKey>();
  for (let p: any = target; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Reflect.ownKeys(p)) {
      if (key === "constructor" || seen.has(key)) continue;
      seen.add(key); // Do not overwrite an override with its ancestor's method.
      const d = Object.getOwnPropertyDescriptor(p, key);
      if (typeof d?.value === "function") {
        Object.defineProperty(target, key, { configurable: true, writable: true, value: wrap(key, d.value) });
      }
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
    snapshot() { return { methods: { ...calls }, total: Object.values(calls).reduce((a, b) => a + b, 0), lotsRead, lotsWritten }; },
  };
}
