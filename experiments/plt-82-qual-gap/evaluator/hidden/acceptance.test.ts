import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createApp } from "../src/app.ts";
import { InMemoryOrderStore } from "../src/orders/integration/order-store.ts";
import { InMemoryLoyaltyStore } from "../src/loyalty/integration/loyalty-store.ts";
import type { PointsLot } from "../src/loyalty/domain/points.ts";
import { countedStore } from "./store-counter.ts";

const START = Date.parse("2042-04-10T12:00:00Z");
const DAY = 86400000;
const alice = { authorization: "Bearer alice-token" };
const bob = { authorization: "Bearer bob-token" };
const sessions = { lookup: (token: string) => token === "alice-token" ? { id: "alice" } : token === "bob-token" ? { id: "bob" } : undefined };
const order = (id = "o1", extra: any = {}) => ({
  id, customerId: "alice", status: "pending" as const, region: "DE",
  lines: [{ sku: "item", unitPriceCents: 10005, quantity: 1 }], ...extra,
});
const lot = (id: string, points: number, expiry = START + 10 * DAY, customerId = "alice"): PointsLot => ({ id, points, expiresAt: new Date(expiry), customerId });

function fixture(t: TestContext, ordersSeed = [order()], lots = [lot("a", 2000)], loyalty?: InMemoryLoyaltyStore) {
  let at = START;
  t.mock.timers.enable({ apis: ["Date"], now: at });
  const orders = new InMemoryOrderStore(ordersSeed);
  const ledger = loyalty ?? new InMemoryLoyaltyStore(lots);
  const router = createApp({ orders, loyalty: ledger, sessions, now: () => new Date(at) });
  return {
    ledger, router,
    advance(to: number) { at = to; t.mock.timers.setTime(to); },
    redeem(points: number, key: string, id = "o1", headers = alice) {
      return router.handle({ method: "POST", path: `/orders/${id}/redeem`, headers, body: { points, idempotencyKey: key } });
    },
    cancel(id = "o1", headers = alice) { return router.handle({ method: "POST", path: `/orders/${id}/cancel`, headers }); },
    quote(id = "o1") { return router.handle({ method: "GET", path: `/orders/${id}/quote`, headers: alice }); },
  };
}
function success(r: any) { assert.ok(r.status >= 200 && r.status < 300, `expected success, got ${r.status}: ${JSON.stringify(r.body)}`); }
function rejected(r: any) { assert.ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`); }

// Names, nesting and suffixes are deliberately not part of the contract. Search
// numeric quote fields recursively; exclude subtotal from the total matcher.
function field(body: unknown, kind: "subtotal" | "discount" | "point" | "tax" | "total"): number {
  const found: { value: number; score: number }[] = [];
  function visit(value: any, parent = "") {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const name = key.toLowerCase().replace(/[^a-z]/g, "");
      const path = parent + name;
      const matches = path.includes(kind) && !(kind === "total" && path.includes("subtotal"));
      if (typeof child === "number" && matches) {
        let score = (name.includes(kind) ? 10 : 0) + (/applied|redeemed|used|cents|amount/.test(name) ? 3 : 0) - (/balance|remaining|requested|available|rate/.test(path) ? 100 : 0);
        if (new RegExp(`^${kind}(cents|amount)?$`).test(name)) score += 20;
        if (kind === "discount" && /subtotal|point/.test(path)) score -= 30;
        if (kind === "total" && /^(totaldiscount|totaltax|totalpoint)/.test(name)) score -= 20;
        found.push({ value: child, score });
      } else if (child && typeof child === "object") visit(child, path);
    }
  }
  visit(body);
  assert.ok(found.length, `missing numeric ${kind} field: ${JSON.stringify(body)}`);
  return found.sort((a, b) => b.score - a.score)[0]!.value;
}
function expectQuote(r: any, expected: number[]) {
  success(r);
  const actual = (["subtotal", "discount", "point", "tax", "total"] as const).map(k => field(r.body, k));
  for (const value of actual) assert.ok(Number.isInteger(value) && value >= 0, `money/points must be non-negative integer: ${value}`);
  assert.deepEqual(actual, expected, "subtotal, discount, points applied (cents), tax, total");
}
async function snapshot(f: ReturnType<typeof fixture>, customer = "alice") {
  return (await f.ledger.lotsFor(customer)).sort((a, b) => a.id.localeCompare(b.id));
}
function remaining(lots: PointsLot[]) { return lots.reduce((sum, l) => sum + l.points, 0); }

// All tests are independent and sequential within this file. No timer other
// than Date is mocked: the real asynchronous ledger must continue yielding.
test("[T-ORDER] discount then points then rounded tax; one point is one cent", async t => {
  const f = fixture(t, [order("o1", { discountCode: "SAVE10" })]);
  const before = await f.quote(); success(before);
  assert.equal(field(before.body, "discount"), 1001);
  expectQuote(await f.redeem(137, "rounding"), [10005, 1001, 137, 1685, 10552]);
  assert.equal(remaining(await snapshot(f)), 1863);
});

test("[T-ORDER] cap at discounted amount and do not consume excess", async t => {
  const f = fixture(t, [order("o1", { lines: [{ sku: "x", unitPriceCents: 1001, quantity: 1 }], discountCode: "FLAT5" })]);
  expectQuote(await f.redeem(800, "cap"), [1001, 500, 501, 0, 0]);
  assert.equal(remaining(await snapshot(f)), 1499);
});

test("[T-ORDER] fully discounted order consumes zero points", async t => {
  const f = fixture(t, [order("o1", { lines: [{ sku: "x", unitPriceCents: 300, quantity: 1 }], discountCode: "FLAT5" })]);
  expectQuote(await f.redeem(100, "free"), [300, 300, 0, 0, 0]);
  assert.equal(remaining(await snapshot(f)), 2000);
});

test("[T-LOTS] skip expired lots, earliest expiry first, consume a partial lot", async t => {
  const seed = [lot("late", 500, START + 20 * DAY), lot("expired", 999, START - DAY), lot("middle", 200, START + 2 * DAY), lot("early", 70, START + DAY), lot("bob", 900, START + DAY, "bob")];
  const f = fixture(t, [order()], seed);
  success(await f.redeem(160, "lots"));
  const after = await snapshot(f);
  assert.deepEqual(Object.fromEntries(after.map(l => [l.id, l.points])), { early: 0, expired: 999, late: 500, middle: 110 });
  for (const current of after) assert.equal(current.expiresAt.getTime(), seed.find(l => l.id === current.id)!.expiresAt.getTime());
  assert.equal(remaining(await snapshot(f, "bob")), 900);
});

test("[T-IDEM] identical replay returns identical result without consuming again", async t => {
  const f = fixture(t);
  const first = await f.redeem(175, "replay"); success(first);
  const after = await snapshot(f);
  const again = await f.redeem(175, "replay"); success(again);
  assert.deepEqual(again.body, first.body);
  assert.deepEqual(await snapshot(f), after);
});

test("[T-IDEM] same key with changed points is rejected without consuming", async t => {
  const f = fixture(t);
  const first = await f.redeem(175, "conflict"); success(first);
  const after = await snapshot(f);
  rejected(await f.redeem(176, "conflict"));
  assert.deepEqual(await snapshot(f), after);
  const replay = await f.redeem(175, "conflict"); success(replay);
  assert.deepEqual(replay.body, first.body);
  assert.deepEqual(await snapshot(f), after);
});

async function race(t: TestContext, count: number, seed: PointsLot[], request: number) {
  const f = fixture(t, Array.from({ length: count }, (_, i) => order(`o${i}`)), seed);
  const initial = remaining(seed);
  const responses = await Promise.all(Array.from({ length: count }, (_, i) => f.redeem(request, `race-${i}`, `o${i}`)));
  let applied = 0, wins = 0;
  for (const r of responses) {
    if (r.status >= 200 && r.status < 300) {
      const p = field(r.body, "point");
      assert.ok(Number.isInteger(p) && p >= 0 && p <= request);
      applied += p; if (p > 0) wins++;
    } else rejected(r); // Depleted balance may be rejected OR partially fulfilled.
  }
  assert.ok(wins > 0, "at least one initially affordable redemption must succeed");
  const after = await snapshot(f);
  for (const l of after) assert.ok(Number.isInteger(l.points) && l.points >= 0, "no negative lot");
  assert.ok(applied <= initial, `double spend: applied ${applied} from ${initial}`);
  assert.equal(applied, initial - remaining(after), "all reported points must equal actual removal, not lost writes");
}
test("[T-RACE] two orders cannot double-spend one asynchronous lot", async t => {
  await race(t, 2, [lot("shared", 500)], 400);
});
test("[T-RACE] six concurrent orders spanning partial lots conserve points", async t => {
  await race(t, 6, [lot("a", 101, START + DAY), lot("b", 203, START + 2 * DAY), lot("c", 307, START + 3 * DAY)], 250);
});

test("[T-REVERSAL] cancel restores original lots and expiry without new lots", async t => {
  const seed = [lot("late", 300, START + 8 * DAY), lot("early", 90, START + 2 * DAY)];
  const f = fixture(t, [order()], seed);
  success(await f.redeem(210, "restore"));
  assert.equal(remaining(await snapshot(f)), 180);
  success(await f.cancel());
  assert.deepEqual(await snapshot(f), [...seed].sort((a, b) => a.id.localeCompare(b.id)));
});

test("[T-REVERSAL] cancellation forfeits expired allocations but restores live originals", async t => {
  const seed = [lot("soon", 90, START + DAY), lot("live", 300, START + 10 * DAY)];
  const f = fixture(t, [order()], seed);
  success(await f.redeem(210, "forfeit"));
  f.advance(START + DAY); // Expiry is exclusive, including during reversal.
  success(await f.cancel());
  const after = await snapshot(f);
  assert.deepEqual(after.map(l => [l.id, l.points, l.expiresAt.getTime()]), [
    ["live", 300, START + 10 * DAY], ["soon", 0, START + DAY],
  ]);
});

// Positive preconditions prevent the absent /redeem route in base from
// accidentally passing rejection-only tests.
test("[T-AUTH] missing session is 401 and cannot consume points", async t => {
  const f = fixture(t, [order("control"), order()]);
  success(await f.redeem(10, "control", "control"));
  const before = await snapshot(f);
  assert.equal((await f.redeem(100, "anonymous", "o1", {})).status, 401);
  assert.deepEqual(await snapshot(f), before);
});
test("[T-AUTH] another customer's order is 403 or 404 and consumes nothing", async t => {
  const f = fixture(t, [order("control"), order()], [lot("a", 1000), lot("b", 1000, START + DAY, "bob")]);
  success(await f.redeem(10, "control", "control"));
  const a = await snapshot(f), b = await snapshot(f, "bob");
  assert.ok([403, 404].includes((await f.redeem(100, "intruder", "o1", bob)).status));
  assert.deepEqual(await snapshot(f), a);
  assert.deepEqual(await snapshot(f, "bob"), b);
});

for (const status of ["shipped", "cancelled"]) {
  test(`[T-PENDING] ${status} order rejects redemption without consumption`, async t => {
    const f = fixture(t, [order("control"), order("o1", { status })]);
    success(await f.redeem(10, "control", "control"));
    const before = await snapshot(f);
    rejected(await f.redeem(100, "not-pending"));
    assert.deepEqual(await snapshot(f), before);
  });
}

test("[T-CLOCK] expiry uses controlled current time not wall-clock year", async t => {
  const f = fixture(t, [order()], [lot("old", 500, START - DAY), lot("current", 500, START + DAY)]);
  success(await f.redeem(100, "time"));
  assert.deepEqual((await snapshot(f)).map(l => [l.id, l.points]), [["current", 400], ["old", 500]]);
});
test("[T-CLOCK] advancing to expiry excludes a previously usable lot", async t => {
  const f = fixture(t, [order("control"), order()], [lot("edge", 300, START + DAY), lot("later", 500, START + 3 * DAY)]);
  success(await f.redeem(50, "before", "control"));
  assert.equal((await f.ledger.getLot("edge"))!.points, 250);
  f.advance(START + DAY);
  success(await f.redeem(100, "at-expiry"));
  assert.deepEqual((await snapshot(f)).map(l => [l.id, l.points]), [["edge", 250], ["later", 400]]);
});

test("[T-EFFICIENCY] INFORMATIONAL store calls with long history", async t => {
  const seed = Array.from({ length: 1200 }, (_, i) => lot(`history-${i}`, i % 2 ? 0 : 7, START - DAY - i));
  seed.push(...Array.from({ length: 40 }, (_, i) => lot(`live-${i}`, 100, START + (i + 1) * DAY)));
  const counter = countedStore(seed);
  const f = fixture(t, [order("one"), order("two")], seed, counter.store);
  const measurements: Record<string, unknown> = { seed: { historicalLots: 1200, liveLots: 40 }, redemptions: [] };
  try {
    for (const [id, key] of [["one", "first"], ["two", "second"], ["two", "second"]]) {
      counter.reset();
      const response = await f.redeem(150, key!, id!);
      (measurements.redemptions as unknown[]).push({ id, key, status: response.status, ...counter.snapshot() });
      success(response);
    }
  } finally {
    writeFileSync(process.env.EVALUATOR_STORE_CALLS ?? new URL("./store-calls.json", import.meta.url), JSON.stringify(measurements, null, 2));
  }
});
