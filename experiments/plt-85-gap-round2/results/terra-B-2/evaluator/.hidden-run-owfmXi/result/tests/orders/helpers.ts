import { createApp } from "../../src/app.ts";
import { InMemoryOrderStore } from "../../src/orders/integration/order-store.ts";
import { InMemoryLoyaltyStore } from "../../src/loyalty/integration/loyalty-store.ts";
import type { Order } from "../../src/orders/domain/order.ts";
import type { PointsLot } from "../../src/loyalty/domain/points.ts";
import { seedTokens } from "../../src/seed.ts";

export function app(seed: Order[], lots: PointsLot[] = [], now = () => new Date("2026-11-19T12:00:00Z")) {
  const orders = new InMemoryOrderStore(seed);
  const loyalty = new InMemoryLoyaltyStore(lots);
  const sessions = { lookup: (t: string) => (seedTokens[t] ? { id: seedTokens[t]! } : undefined) };
  const router = createApp({ orders, loyalty, sessions, now });
  return { router, orders, loyalty };
}
export const asAlice = { authorization: "Bearer tok-alice" };
export const asBob = { authorization: "Bearer tok-bob" };
export const pendingOrder = (over: Partial<Order> = {}): Order => ({
  id: "o1", customerId: "alice", status: "pending", region: "DE",
  lines: [{ sku: "sku-1", unitPriceCents: 2500, quantity: 4 }], ...over,
});
