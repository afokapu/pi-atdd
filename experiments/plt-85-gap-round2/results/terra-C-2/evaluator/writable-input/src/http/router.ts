export type Request = {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
};
export type Response = { status: number; body: unknown };
export type Params = Record<string, string>;
export type Handler = (req: Request, params: Params) => Response | Promise<Response>;

type Route = { method: Request["method"]; pattern: string; handler: Handler };

export class Router {
  private routes: Route[] = [];
  add(method: Request["method"], pattern: string, handler: Handler): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }
  async handle(req: Request): Promise<Response> {
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = match(route.pattern, req.path);
      if (params) return route.handler(req, params);
    }
    return { status: 404, body: { error: "not found" } };
  }
}

function match(pattern: string, path: string): Params | null {
  const p = pattern.split("/").filter(Boolean), s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
