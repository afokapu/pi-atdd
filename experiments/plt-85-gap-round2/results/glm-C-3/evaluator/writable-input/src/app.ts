import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";
import { InMemoryRedemptionStore } from "./loyalty/integration/redemption-store.ts";
import { OwnerLocks } from "./loyalty/application/owner-locks.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
  /** Redemption ledger. Defaults to an in-memory store. */
  redemptions?: InMemoryRedemptionStore;
};

/** Composition root: every route of the service on one router. */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  const locks = new OwnerLocks();
  const redemptions = deps.redemptions ?? new InMemoryRedemptionStore();
  const now = deps.now ?? (() => new Date());
  orderRoutes(router, { orders: deps.orders, sessions: deps.sessions, loyalty: deps.loyalty, redemptions, locks, now });
  return router;
}
