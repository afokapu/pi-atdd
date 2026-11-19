import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";
import { InMemoryRedemptionStore } from "./loyalty/integration/redemption-store.ts";
import { RedeemService } from "./loyalty/application/redeem-service.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Redemption ledger; defaults to an empty in-memory store. */
  redemptions?: InMemoryRedemptionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
};

/** Composition root: every route of the service on one router. */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  const redemptions = deps.redemptions ?? new InMemoryRedemptionStore();
  const redeem = new RedeemService(deps.loyalty, redemptions);
  orderRoutes(router, {
    orders: deps.orders,
    sessions: deps.sessions,
    redeem,
    now: deps.now ?? (() => new Date()),
  });
  return router;
}
