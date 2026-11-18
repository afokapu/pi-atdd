/** Pi-native context activation. The Pi extension contains no Python process or toolchain. */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCatalog, loadConfig, resolveContext, type Catalog, type Selector } from "../src/catalog.ts";

function relativeFile(cwd: string, supplied: string): string | null {
  const abs = resolve(cwd, supplied), p = relative(cwd, abs);
  if (p === ".." || p.startsWith(".." + sep) || isAbsolute(p)) return null;
  return p.replaceAll("\\", "/");
}
/** Context-sized excerpt of the authored rule, without changing its obligation. */
const excerpt = (value: string, max = 1600) =>
  value.length <= max ? value : value.slice(0, max) + "\n[continued in canonical source]";

export function explain(ctx: ReturnType<typeof resolveContext>,
    subset: ReturnType<typeof resolveContext>["rules"] = ctx.rules): string {
  const warning = ctx.unresolvedReferences.length
    ? "GRAPH INCOMPLETE: " + ctx.unresolvedReferences.length +
      " external/unresolved edges. This is not evidence that no other rules apply." : "";
  if (ctx.status === "unresolved")
    return "ATDD applicability GAP: no selector matched. Consult canonical conventions; this is NOT an exemption.";
  const links = ctx.relatedRelations;
  return [
    "ATDD reasoning from the SHA-pinned canonical convention graph (NOT an independent compliance verdict):",
    ...subset.map(rule => {
      const origin = ctx.sourceLocks.find(src => src.id === rule.source);
      const relativeSource = rule.file.slice(rule.source.length + 1);
      const sourcePath = origin ? join(origin.path, relativeSource) : rule.file;
      const related = links.filter(edge => edge.source === rule.id || edge.target === rule.id);
      return [
        "Convention: " + rule.id + " — " + excerpt(rule.statement, 950),
        "Canonical file: " + sourcePath,
        "Source digest: " + (origin?.digest || "unknown") + "; disposition: " + (rule.disposition ?? "unspecified"),
        rule.summary ? "Intent / rationale: " + excerpt(rule.summary, 580) : "",
        rule.guidance ? "Original implementation guidance:\n" + excerpt(rule.guidance, 1800) :
          "No implementation recipe provided in this rule; consult the complete canonical source.",
        ...rule.exceptions.slice(0, 6).map(exception => "Authored exception: " + excerpt(exception, 360)),
        rule.exceptions.length > 6 ? "Additional authored exceptions in the canonical file." : "",
        ...related.slice(0, 6).map(edge =>
          "Related obligation: " + edge.source + " -" + edge.type + "-> " + edge.target +
          " (" + edge.constraint + ", " + edge.control + ") " + excerpt(edge.reason, 400)),
        related.length > 6 ? "Additional related graph edges exist in the catalog." : "",
        rule.implementationRef
          ? "Existing implementation/detector reference: " + rule.implementationRef +
            " (reference only; no check has been run)"
          : "No executable detector reference declared by this rule.",
        "Activation evidence: " + rule.reasons.join(", "),
        "Verification: select relevant acceptance, tests, detectors and observable runtime evidence; " +
          "do not infer satisfaction from this context delivery.",
      ].filter(Boolean).join("\n");
    }),
    ctx.truncated ? "WARNING: Context truncated; retrieve additional rules before claiming completeness." : "",
    warning,
    "Alternatives must satisfy the original obligation, retain evidence, and receive independent review. " +
      "Do not self-waive, downgrade or rewrite strict rules.",
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
