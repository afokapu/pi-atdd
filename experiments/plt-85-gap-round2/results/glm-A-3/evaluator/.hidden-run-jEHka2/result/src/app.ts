import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";
import { RedeemService } from "./orders/application/redeem-service.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
};

/** Composition root: every route of the service on one router. */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  const redeem = new RedeemService(deps.orders, deps.loyalty, deps.now);
  orderRoutes(router, { orders: deps.orders, sessions: deps.sessions, redeem });
  return router;
}
