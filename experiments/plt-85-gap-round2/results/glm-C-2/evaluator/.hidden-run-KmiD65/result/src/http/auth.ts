import type { Handler, Params, Request, Response } from "./router.ts";

export type Customer = { id: string };
export type SessionStore = { lookup(token: string): Customer | undefined };

/** Resolve the signed-in customer from `authorization: Bearer <token>`. */
export function currentCustomer(req: Request, sessions: SessionStore): Customer | undefined {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) return undefined;
  return sessions.lookup(header.slice("Bearer ".length).trim());
}

export type AuthedHandler = (req: Request, params: Params, customer: Customer) => Response | Promise<Response>;

/** Wrap a handler so that it only runs for a signed-in customer (401 otherwise). */
export function withCustomer(sessions: SessionStore, handler: AuthedHandler): Handler {
  return (req, params) => {
    const customer = currentCustomer(req, sessions);
    if (!customer) return { status: 401, body: { error: "authentication required" } };
    return handler(req, params, customer);
  };
}
