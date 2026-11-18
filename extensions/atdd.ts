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

// The live extension uses incremental typed facts; explain() above remains a
// compatibility renderer for the original PR1 acceptance tests.
export { default } from "../src/pi-activation.ts";
