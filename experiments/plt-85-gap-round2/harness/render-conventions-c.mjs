/**
 * PLT-85: conventions-c.md = PLT-82 conventions.md (unchanged bytes) + the 5 audited gap
 * conventions, rendered with the exact PLT-82 block format (coder-facing fields only).
 * Usage: node render-conventions-c.mjs <gapFleetDir> <plt82ConventionsMd> <outDir>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const [G, B, OUT] = process.argv.slice(2);
const IDS = ["coder.bun.money-integer-minor-units-adjustment-order", "coder.bun.idempotent-replay-stored-result",
  "coder.bun.atomic-check-and-debit-async-store", "coder.bun.compensating-reversal-original-entries", "coder.bun.indexed-lookup-no-history-scan"];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const list = (h, xs) => xs?.length ? `${h}\n${xs.map(x => "- " + x).join("\n")}\n` : "";
const base = readFileSync(B, "utf8");
const meta = {};
const blocks = IDS.map(id => {
  const res = JSON.parse(readFileSync(join(G, id, "result.json"), "utf8"));
  if (res.status !== "PASS") throw new Error(id + " not PASS: " + res.status);
  const raw = readFileSync(join(G, id, "author.json")); const a = JSON.parse(raw);
  if (a.rule_id !== id) throw new Error("id mismatch " + id);
  meta[id] = { authorJsonSha256: sha(raw), rounds: res.rounds.length, cost: res.cost };
  return `## ${id} — ${a.title}\n\nGIVEN ${a.given}\nWHEN ${a.when}\nTHEN ${a.then}\n\n`
    + list("PREFER", a.prefer) + list("AVOID", a.avoid) + list("UNLESS", a.unless)
    + `WHY ${a.why}\n\n` + list("EVIDENCE", a.evidence);
});
const md = base + "\n" + blocks.join("\n");
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "conventions-c.md"), md);
writeFileSync(join(OUT, "gap-selection.json"), JSON.stringify({ schema: "pi-atdd/plt-85/gap-conventions/v1",
  note: "Arm C = PLT-82 conventions.md (unchanged prefix) + 5 new general conventions authored for PLT-85 (declared bias: written knowing PLT-82's uncovered traps; Arm C is a best case).",
  author: "pi-claude-cli/claude-opus-5-5 (medium)", auditor: "openai-codex/gpt-6.1-sol (medium)",
  renderedFields: ["title", "given", "when", "then", "prefer", "avoid", "unless", "why", "evidence"],
  withheld: ["activation", "verifier_detail", "audit", "splitSuggestion", "sharedNodes", "additions", "trace"],
  baseConventionsMdSha256: sha(base), ids: IDS, gap: meta, conventionsCMdSha256: sha(md), conventionsCMdChars: md.length, conventionsCMdEstTokens: Math.ceil(md.length / 4) }, null, 2) + "\n");
console.log(sha(md), md.length);
