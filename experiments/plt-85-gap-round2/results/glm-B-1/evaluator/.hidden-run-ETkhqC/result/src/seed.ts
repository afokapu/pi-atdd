import type { Order } from "./orders/domain/order.ts";
import type { PointsLot } from "./loyalty/domain/points.ts";

/** Demo data. Bearer tokens map to customers; lots include an already-expired one (lot-a3). */
export const seedTokens: Record<string, string> = { "tok-alice": "alice", "tok-bob": "bob" };

export const seedOrders: Order[] = [
  { id: "o1", customerId: "alice", status: "pending", region: "DE", discountCode: "SAVE10",
    lines: [{ sku: "book", unitPriceCents: 1999, quantity: 2 }, { sku: "pen", unitPriceCents: 350, quantity: 3 }] },
  { id: "o2", customerId: "alice", status: "shipped", region: "DE", lines: [{ sku: "lamp", unitPriceCents: 4500, quantity: 1 }] },
  { id: "o3", customerId: "bob", status: "pending", region: "FR", discountCode: "FLAT5",
    lines: [{ sku: "mug", unitPriceCents: 1250, quantity: 4 }] },
];

// Alice's lots intentionally mix expiries around the demo date 2026-11-19:
// lot-a2 expires first (consume it first), lot-a3 is already expired (unusable).
export const seedLots: PointsLot[] = [
  { id: "lot-a1", customerId: "alice", points: 300, expiresAt: new Date("2026-12-31T00:00:00Z") },
  { id: "lot-a2", customerId: "alice", points: 500, expiresAt: new Date("2026-12-01T00:00:00Z") },
  { id: "lot-a3", customerId: "alice", points: 1000, expiresAt: new Date("2025-06-30T00:00:00Z") },
  { id: "lot-b1", customerId: "bob", points: 250, expiresAt: new Date("2027-03-31T00:00:00Z") },
];
