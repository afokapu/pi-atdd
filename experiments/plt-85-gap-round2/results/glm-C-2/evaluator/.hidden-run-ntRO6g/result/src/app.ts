import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";
import { InMemoryRedemptionStore } from "./loyalty/integration/redemption-store.ts";
import { PerKeyLock } from "./orders/application/per-key-lock.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Redemption ledger (idempotent replay + reversal on cancel). Defaults to a fresh in-memory ledger. */
  redemptions?: InMemoryRedemptionStore;
  /** Per-customer locks shared by redeem and cancel. Defaults to a fresh lock table. */
  locks?: PerKeyLock;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
};

/** Composition root: every route of the service on one router. */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  orderRoutes(router, {
    orders: deps.orders,
    loyalty: deps.loyalty,
    sessions: deps.sessions,
    redemptions: deps.redemptions ?? new InMemoryRedemptionStore(),
    locks: deps.locks ?? new PerKeyLock(),
    now: deps.now ?? (() => new Date()),
  });
  return router;
}
