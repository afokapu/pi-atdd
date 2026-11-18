/** Pi-native context activation. The Pi extension contains no Python process or toolchain. */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCatalog, loadConfig, resolveContext, type Catalog, type Selector } from "../src/catalog.ts";

function relativeFile(cwd: string, supplied: string): string | null {
  const abs = resolve(cwd, supplied), p = relative(cwd, abs);
  if (p === ".." || p.startsWith(".." + sep) || isAbsolute(p)) return null;
  return p.replaceAll("\\", "/");
}
function explain(ctx: ReturnType<typeof resolveContext>, subset = ctx.rules): string {
  const warning = ctx.unresolvedReferences.length
    ? "NOTE: Upstream graph has " + ctx.unresolvedReferences.length + " external/unresolved edges. Check context before claiming comprehensive coverage." : "";
  if (ctx.status === "unresolved") return "ATDD applicability GAP: no selector matched. Consult canonical conventions; this is NOT an exemption.";
  return [
    "ATDD conventions selected from pinned ATDD-Bun and ATDD Flow (guidance, NOT certified compliance):",
    ...subset.map(rule => [
      "Rule: " + rule.id + " — " + rule.statement.slice(0, 850),
      "Source: " + rule.file + ", original disposition: " + (rule.disposition ?? "unspecified"),
      "Rationale: " + rule.summary.slice(0, 450),
      ...rule.exceptions.slice(0, 4).map(ex => "Exception: " + ex.slice(0, 320)),
      "Activated by: " + rule.reasons.join(", "),
      "Read full canonical source before proposing an alternative.",
    ].join("\n")),
    ctx.truncated ? "WARNING: Context truncated; retrieve further conventions before claiming completeness." : "",
    warning,
    "An implementation alternative must preserve the obligation and provide verifiable evidence. Do not self-waive strict rules.",
  ].filter(Boolean).join("\n\n");
}

export default function atdd(pi: ExtensionAPI) {
  let task = "";
  let catalog: Catalog | undefined;
  let selectors: Selector[] = [];
  let cwdKey = "";
  const sent = new Set<string>();
  const unresolvedPaths = new Set<string>();

  function ensure(cwd: string): void {
    if (catalog && cwdKey === cwd) return;
    const config = loadConfig(cwd);
    catalog = loadCatalog(config.sources, cwd);
    selectors = config.selectors;
    cwdKey = cwd;
    sent.clear();
    unresolvedPaths.clear();
  }
  pi.registerCommand("atdd", {
    description: "Show ATDD convention activation status for the current project",
    handler: async (_args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("ATDD requires a trusted project", "warning");
        return;
      }
      try {
        ensure(ctx.cwd);
        ctx.ui.notify("ATDD: " + catalog!.rules.size + " pinned rules; " +
          catalog!.unresolvedEdges.length + " unresolved external graph references", "info");
      } catch (e) { ctx.ui.notify("ATDD graph invalid: " + String(e), "error"); }
    },
  });
  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    if (event.messageType === "user") {
      task = event.prompt || "";
      sent.clear(); unresolvedPaths.clear();
      catalog = undefined;
    }
    try {
      ensure(ctx.cwd);
      const context = resolveContext(catalog!, selectors, task, [], "task");
      context.matchingIds.forEach(id => sent.add(id));
      return { message: { customType: "pi-atdd-rules", content: explain(context), display: false } };
    } catch (error) {
      return { message: { customType: "pi-atdd-rules",
        content: "ATDD graph ERROR. Stop governed changes until fixed: " + String(error), display: true } };
    }
  });
  pi.on("tool_call", (event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const input = event.input as { path?: unknown };
    if (typeof input.path !== "string") return { block: true, reason: "ATDD edit path is missing." };
    const path = relativeFile(ctx.cwd, input.path);
    if (path === null) return { block: true, reason: "ATDD does not authorize edits outside the governed project." };
    try {
      ensure(ctx.cwd);
      const context = resolveContext(catalog!, selectors, task, [path], event.toolName === "edit" ? "edit" : "create");
      const novel = context.rules.filter(rule => !sent.has(rule.id));
      if (context.truncated) return { block: true, reason: "ATDD convention selection was truncated; inspect full graph before editing." };
      if (novel.length) {
        novel.forEach(rule => sent.add(rule.id));
        return { block: true, reason: "ATDD pre-edit convention activation. Review these rules and retry:\n\n" + explain(context, novel) };
      }
      if (context.status === "unresolved" && !unresolvedPaths.has(path)) {
        unresolvedPaths.add(path);
        return { block: true, reason: "ATDD applicability is unresolved for " + path + ". Inspect canonical conventions; retry only after assessment." };
      }
    } catch (error) { return { block: true, reason: "ATDD graph check failed: " + String(error) }; }
  });
}
