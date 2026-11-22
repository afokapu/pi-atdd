// PLT-87 N-004: PLT-79-style activation probe. Runs a fixed set of observations
// through the bundled catalog (selector resolver + reasoning session) and prints
// the delivered rule ids per scenario as JSON. Run on v0.2.0 and after the
// rename; tests/profile-naming.test.ts compares the two through the alias map.
//   node --experimental-strip-types tools/profile-naming/probe.ts > out.json
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig, resolveContext } from "../../src/catalog.ts";
import { ReasoningSession, type ContextObservation } from "../../src/reasoning-context.ts";

export const scenarios: Array<Omit<ContextObservation, "scope" | "origin" | "provenance">> = [
  { task: "Perform final behavioral review", operation: "review" },
  { task: "Review the integration branch before merge readiness", operation: "review", path: "src/workspace/driver.ts" },
  { task: "Implement acceptance for checkout, go green", operation: "edit", path: "src/orders/application/checkout.ts" },
  { task: "Update order model", operation: "edit", path: "src/orders/domain/order.ts" },
  { task: "Make the green test pass", operation: "edit", path: "src/orders/domain/order.ts", phase: "GREEN" },
  { task: "Add authentication to the payment endpoint", operation: "edit", path: "src/payments/routes/pay.ts" },
  { task: "Fix layer boundary imports in integration", operation: "edit", path: "src/pricing/integration/client.ts" },
  { task: "Add acceptance test binding and coverage", operation: "create", path: "tests/orders/checkout.test.ts" },
  { task: "Write e2e journey", operation: "create", path: "e2e/journeys/checkout.journey.test.ts" },
  { task: "Coordinator: set up a jujutsu worktree for the integration branch", operation: "task" },
  { task: "Handover and delegation through the agent inbox", operation: "task", path: "src/agent/messaging/inbox.ts" },
  { task: "Persist runtime state", operation: "edit", path: "src/core/runtime-state.ts" },
  { task: "Update documentation", operation: "edit", path: "docs/index.md" },
  { task: "Refactor the presentation view", operation: "edit", path: "src/shop/presentation/view.ts" },
];

export function probe(cwd: string): Record<string, { context: string[]; reasoning: string[] }> {
  const config = loadConfig(cwd);
  const catalog = loadCatalog(config.sources, cwd);
  const out: Record<string, { context: string[]; reasoning: string[] }> = {};
  scenarios.forEach((s, i) => {
    const session = new ReasoningSession(catalog, config.selectors);
    const r = session.observe({ ...s, scope: "probe-" + i,
      origin: s.phase ? "trusted-work-provider" : "pi-event", provenance: "plt-87-probe",
      // Fixed synthetic fixture revision, NOT inferred work-provider authority.
      ...(s.phase ? {revision:"fixture:plt-87-profile-probe"} : {}),
    });
    const ctx = resolveContext(catalog, config.selectors, s.task, s.path ? [s.path] : [], s.operation, 100);
    out[String(i).padStart(2, "0") + " " + s.task] = {
      context: [...ctx.matchingIds].sort(),
      reasoning: r.activations.map(a => a.id).sort(),
    };
  });
  return out;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-probe-"));
  try { process.stdout.write(JSON.stringify(probe(cwd), null, 2) + "\n"); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
}
