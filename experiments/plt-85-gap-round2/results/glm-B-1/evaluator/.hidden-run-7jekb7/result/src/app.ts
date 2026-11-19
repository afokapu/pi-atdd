import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import { RedeemService } from "./orders/application/redeem-service.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
};

/**
 * Composition root: every route of the service on one router. This is the
 * only place collaborators are constructed; tests pass their own stores in
 * via `deps` (all optional except the stores themselves).
 */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  // The redeem use case needs the injected clock so tests can travel in time.
  const redeem = new RedeemService({
    orders: deps.orders,
    loyalty: deps.loyalty,
    now: deps.now ?? (() => new Date()),
  });
  orderRoutes(router, { orders: deps.orders, sessions: deps.sessions, redeem });
  return router;
}
