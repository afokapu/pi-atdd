// Re-run ONLY the auditor once for conventions whose final round has a passing mechanical
// check but no parsed audit because of a provider/infrastructure error (e.g. WebSocket idle
// timeout). The author output is not changed. Both attempts are kept.
// Usage: node audit-retry.mjs <listfile> [--concurrency 4]
import { existsSync, readFileSync, writeFileSync, copyFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET, runPi, usageOf } from "./lib.mjs";
import { check } from "./check.mjs";

const [listFile] = process.argv.slice(2);
const conc = Number(process.argv[process.argv.indexOf("--concurrency") + 1] || 4);
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(FLEET, "fleet.log"), l + "\n"); };
const AUDITOR = { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,write,ls" };
const ids = readFileSync(listFile, "utf8").split(/\s+/).filter(Boolean).filter(id => {
  const p = join(FLEET, "runs", id, "result.json"); if (!existsSync(p)) return false;
  const r = JSON.parse(readFileSync(p, "utf8")); const last = r.rounds.at(-1);
  return last.check.ok && !["PASS", "FAIL"].includes(last.verdict);
});
log("audit-retry start: " + ids.length);
let busy = 0; const q = [...ids];
await new Promise(fin => { const pump = () => { while (busy < conc && q.length) { const id = q.shift(); busy++; (async () => {
  const dir = join(FLEET, "runs", id), r = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")), n = r.rounds.at(-1).round;
  if (!check(dir).ok) { log(id + " audit-retry skipped: check no longer ok"); return; }
  const out = join(dir, "audit-r" + n + "-retry.jsonl");
  await runPi({ cwd: dir, ...AUDITOR, prompt: readFileSync(join(FLEET, "AUDITOR.md"), "utf8"), out });
  const u = usageOf(out); let a = null; try { a = JSON.parse(readFileSync(join(dir, "audit.json"), "utf8")); copyFileSync(join(dir, "audit.json"), join(dir, "audit-r" + n + "-retry.json")); } catch {}
  r.rounds.at(-1).auditRetry = { ...u, verdict: a?.verdict ?? "AUDIT_UNPARSED", reason: "provider error on first audit attempt" };
  r.status = a?.verdict ?? "AUDIT_UNPARSED"; r.cost += u.cost;
  writeFileSync(join(dir, "result.json"), JSON.stringify(r, null, 2));
  log(id + " audit-retry round " + n + ": audit=" + r.status);
})().finally(() => { busy--; pump(); }); } if (!q.length && !busy) fin(); }; pump(); });
log("audit-retry done");
