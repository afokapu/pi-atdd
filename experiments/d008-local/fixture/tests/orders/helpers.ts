import { Router } from "../../src/http/router.ts";
import { orderRoutes } from "../../src/orders/routes/order-routes.ts";
import { InMemoryOrderStore } from "../../src/orders/integration/order-store.ts";
import type { Order } from "../../src/orders/domain/order.ts";

export function app(seed: Order[]) {
  const orders = new InMemoryOrderStore(seed);
  const tokens: Record<string, string> = { "tok-alice": "alice", "tok-bob": "bob" };
  const sessions = { lookup: (t: string) => (tokens[t] ? { id: tokens[t]! } : undefined) };
  const router = orderRoutes(new Router(), { orders, sessions });
  return { router, orders };
}
export const asAlice = { authorization: "Bearer tok-alice" };
