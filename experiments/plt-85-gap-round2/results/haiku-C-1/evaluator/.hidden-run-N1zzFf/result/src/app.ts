import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import { redeemRoutes } from "./orders/routes/redeem-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";

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
  const now = deps.now ?? (() => new Date());
  orderRoutes(router, { orders: deps.orders, sessions: deps.sessions, loyalty: deps.loyalty, now });
  redeemRoutes(router, { orders: deps.orders, sessions: deps.sessions, loyalty: deps.loyalty, now });
  return router;
}
