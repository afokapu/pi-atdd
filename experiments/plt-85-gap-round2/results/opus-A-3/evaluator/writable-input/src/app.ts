import { Router } from "./http/router.ts";
import type { SessionStore } from "./http/auth.ts";
import { orderRoutes } from "./orders/routes/order-routes.ts";
import type { InMemoryOrderStore } from "./orders/integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "./loyalty/integration/loyalty-store.ts";
import { InMemoryIdempotencyStore } from "./loyalty/integration/idempotency-store.ts";
import { LoyaltyLedger } from "./loyalty/application/ledger-service.ts";

export type AppDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  sessions: SessionStore;
  /** Current time. Defaults to the system clock. */
  now?: () => Date;
  /** Idempotency-key records for point redemptions. Defaults to a fresh in-memory store. */
  idempotency?: InMemoryIdempotencyStore;
};

/** Composition root: every route of the service on one router. */
export function createApp(deps: AppDeps): Router {
  const router = new Router();
  const now = deps.now ?? (() => new Date());
  const ledger = new LoyaltyLedger(deps.loyalty, now);
  const idempotency = deps.idempotency ?? new InMemoryIdempotencyStore();
  orderRoutes(router, { orders: deps.orders, sessions: deps.sessions, ledger, idempotency });
  return router;
}
