/**
 * PLT-82: select catalog conventions (PLT-80/81 fleet, status PASS) whose activation matches
 * what the task touches, and render ONLY coder-facing fields into conventions.md.
 * No convention text is written or edited here; fields are copied verbatim from author.json.
 * Usage: node select-conventions.mjs <fleetRunsDir> <outDir>
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [RUNS, OUT] = process.argv.slice(2);
const RULE = [
  "Candidates: every fleet run whose rule_id starts with `coder.` and whose result.json status is PASS.",
  "Task surface: non-test TypeScript source in domain/application/integration/routes layers, written or edited; one mutating HTTP route; no HTMX/markup/CSS; Node runtime (Bun-stack code-level rules are treated as applying to TS source).",
  "INCLUDE when the activation layer/file_kind/operation facts are satisfiable by that surface (content-level triggers such as DTO names, logger calls, SQL sinks, complexity, secrets are kept: the coder may produce them).",
  "EXCLUDE when activation requires an artifact the base does not have or the task does not touch: coder.htmx.* (HTMX not used); design-system root (design-* except design-hierarchy-import, whose GIVEN is any layered module); ATDD plan/traceability artifacts (green-header-*, green-urn-*, interlocking-*, journey-*, station-master-*, wagon-*, runtime-executes-the-declaration, telemetry-*); commons/shared/features/wagons trees (commons-* except commons-domain-no-framework-import, whose GIVEN is any domain/ module; layer-naming); markup/CSS (responsive-*); package.json/lockfile/tsconfig/runtime tooling (dead-code-reachability, runtime-single-lockfile, runtime-typecheck-enforced, runtime-server-is-bun-serve: obligation is the Bun runtime itself).",
];
const SELECTED = [
  "coder.bun.boundaries-http-client", "coder.bun.commons-domain-no-framework-import",
  "coder.bun.complexity-cyclomatic", "coder.bun.complexity-length", "coder.bun.complexity-nesting",
  "coder.bun.composition-consumer", "coder.bun.composition-root", "coder.bun.design-hierarchy-import",
  "coder.bun.dto-mapper", "coder.bun.dto-placement", "coder.bun.dto-purity", "coder.bun.duplication-intra-layer",
  "coder.bun.error-response-bare-string", "coder.bun.error-response-code-format",
  "coder.bun.logging-console", "coder.bun.logging-structured", "coder.bun.quality-comments", "coder.bun.quality-mi",
  "coder.bun.security-hardcoded-secret", "coder.bun.security-missing-auth", "coder.bun.security-sql-injection",
];
const candidates = readdirSync(RUNS).filter(d => d.startsWith("coder.")).filter(d => {
  try { return JSON.parse(readFileSync(join(RUNS, d, "result.json"), "utf8")).status === "PASS"; } catch { return false; }
}).sort();
for (const id of SELECTED) if (!candidates.includes(id)) throw new Error("selected id is not a PASS candidate: " + id);
const list = (h, xs) => xs?.length ? `${h}\n${xs.map(x => "- " + x).join("\n")}\n` : "";
const blocks = SELECTED.map(id => {
  const a = JSON.parse(readFileSync(join(RUNS, id, "author.json"), "utf8"));
  if (a.rule_id !== id) throw new Error("id mismatch " + id);
  return `## ${id} — ${a.title}\n\nGIVEN ${a.given}\nWHEN ${a.when}\nTHEN ${a.then}\n\n`
    + list("PREFER", a.prefer) + list("AVOID", a.avoid) + list("UNLESS", a.unless)
    + `WHY ${a.why}\n\n` + list("EVIDENCE", a.evidence);
});
const md = "# Project conventions\n\nThe following conventions apply to this codebase.\n\n" + blocks.join("\n");
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "conventions.md"), md);
const sha = createHash("sha256").update(md).digest("hex");
const authorHashes = Object.fromEntries(SELECTED.map(id => [id, createHash("sha256").update(readFileSync(join(RUNS, id, "author.json"))).digest("hex")]));
writeFileSync(join(OUT, "selection.json"), JSON.stringify({
  schema: "pi-atdd/plt-82/convention-selection/v1", source: "PLT-80 proposal fleet runs (PLT-81 audited), result.json status PASS",
  rule: RULE, candidatesCoderPass: candidates.length, selected: SELECTED, excluded: candidates.filter(c => !SELECTED.includes(c)),
  renderedFields: ["title", "given", "when", "then", "prefer", "avoid", "unless", "why", "evidence"],
  withheld: ["activation", "verifier_detail", "audit", "sharedNodes", "additions", "trace", "splitSuggestion"],
  authorJsonSha256: authorHashes, conventionsMdSha256: sha, conventionsMdChars: md.length, conventionsMdEstTokens: Math.ceil(md.length / 4),
}, null, 2) + "\n");
console.log(sha, md.length, SELECTED.length + "/" + candidates.length);
