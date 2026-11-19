// Shared-node deduplication: collect every sharedNodes entry across runs, group by id,
// have the author model merge each group into ONE canonical node that covers every variant,
// then have the auditor verify per-variant coverage. Output: ../shared/<id>/
// Usage: node dedup.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET, runPi, usageOf } from "./lib.mjs";

const RUNS = join(FLEET, "runs"), OUT = join(FLEET, process.env.SHARED_OUT || "../shared");
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(FLEET, "dedup.log"), l + "\n"); };
const groups = {};
for (const d of readdirSync(RUNS)) {
  const p = join(RUNS, d, "author.json"); if (!existsSync(p)) continue;
  let a; try { a = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
  for (const n of a.sharedNodes ?? []) (groups[n.id] ??= []).push({ rule_id: d, kind: n.kind, text: n.text });
}
log("shared ids: " + Object.entries(groups).map(([k, v]) => k + "(" + v.length + ")").join(", "));
const MERGE = `Merge the variants in variants.json into ONE canonical shared ATDD node. Work only in this directory.
Write canonical.json: {"id": "...", "kind": "policy|context", "proposedId": "<keep id, or a better general id if this one is too specific>", "text": "<concise canonical text that carries the knowledge of EVERY variant>", "deliverTo": "coder|verifier|both", "coverage": [{"rule_id": "...", "covered": true, "note": "<where its content lives in text>"}], "notGeneric": [{"rule_id": "...", "content": "<content that is rule-specific and should go back into that rule>"}]}.
Be lossless across variants but do not repeat; group into short bullet lines. Reply DONE.`;
const AUDIT = `Audit canonical.json against variants.json (do not modify them). For every variant decide whether all of its knowledge is carried by canonical.json text (or correctly listed in notGeneric). Write shared-audit.json: {"id": "...", "verdict": "PASS|FAIL", "variants": [{"rule_id": "...", "status": "COVERED|PARTIAL|LOST", "note": "..."}], "summary": "..."}. Reply AUDITED.`;
for (const [id, variants] of Object.entries(groups)) {
  const dir = join(OUT, id.replace(/[^\w.-]/g, "_")); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "variants.json"), JSON.stringify({ id, variants }, null, 2));
  if (existsSync(join(dir, "shared-audit.json"))) continue;
  await runPi({ cwd: dir, provider: "pi-claude-cli", model: "claude-opus-5-5", thinking: "medium", tools: "read,write,ls", prompt: MERGE, out: join(dir, "merge.jsonl") });
  await runPi({ cwd: dir, provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,write,ls", prompt: AUDIT, out: join(dir, "audit.jsonl") });
  let v = null; try { v = JSON.parse(readFileSync(join(dir, "shared-audit.json"), "utf8")); } catch {}
  log(id + " variants=" + variants.length + " audit=" + (v?.verdict ?? "UNPARSED") + " $" + (usageOf(join(dir, "merge.jsonl")).cost + usageOf(join(dir, "audit.jsonl")).cost).toFixed(3));
}
log("dedup done");
