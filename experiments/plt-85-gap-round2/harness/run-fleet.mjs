/**
 * PLT-85: launch the 30 coder runs in schedule order, max 10 concurrent and per-provider caps.
 * A run that ends on a provider quota/429 error is marked VOID (moved to runs-void/<id>-tryN),
 * retried once after a wait; a second failure is left VOID and reported. No model substitution.
 * Usage: node run-fleet.mjs <E> [--only id,id]
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEDULE } from "./schedule.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const argv = process.argv.slice(2); const E = argv[0];
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
const CAP = 10, PCAP = { "pi-claude-cli": 4, "openai-codex": 4, zai: 3 }, RETRY_WAIT_MS = 5 * 60_000;
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(E, "fleet.log"), l + "\n"); };
mkdirSync(join(E, "runs-void"), { recursive: true });
const runOnce = (s) => new Promise(done => {
  const c = spawn(process.execPath, [join(HERE, "run-coder.mjs"), E, s.runId, s.provider, s.modelId, s.arm], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = ""; c.stdout.on("data", d => out += d); c.stderr.on("data", d => err += d);
  c.on("close", code => done({ code, out: out.trim(), err: err.slice(-800) }));
});
const isVoid = (s) => {
  const p = join(E, "runs", s.runId, "run.json"); if (!existsSync(p)) return "no run.json";
  const r = JSON.parse(readFileSync(p, "utf8"));
  const abnormal = r.run.exit !== 0 || r.metrics.stopReasons?.at(-1) === "error";
  return r.quotaSuspect && abnormal ? "quota/429: " + (r.metrics.errorMessages ?? []).join(" ").slice(0, 200) : null;
};
async function one(s) {
  for (let t = 1; t <= 2; t++) {
    log(`START ${s.runId} (${s.provider}/${s.modelId}, arm ${s.arm}) try ${t}`);
    const r = await runOnce(s); log(`END ${s.runId} try ${t}: code=${r.code} ${r.out} ${r.code ? r.err : ""}`);
    const v = isVoid(s);
    if (!v) return;
    const dst = join(E, "runs-void", `${s.runId}-try${t}`);
    if (existsSync(join(E, "runs", s.runId))) renameSync(join(E, "runs", s.runId), dst);
    appendFileSync(join(E, "runs-void", "VOID.txt"), `${new Date().toISOString()} ${s.runId} try ${t} VOID: ${v}\n`);
    log(`VOID ${s.runId} try ${t}: ${v}`);
    if (t === 1) await new Promise(r => setTimeout(r, RETRY_WAIT_MS));
  }
  log(`FAILED ${s.runId}: VOID twice, reported, not substituted`);
}
const queue = SCHEDULE.filter(s => !only || only.includes(s.runId));
const busy = { all: 0 }; for (const p in PCAP) busy[p] = 0;
log(`fleet start ${queue.length} runs`);
await new Promise(done => {
  const pump = () => {
    for (let i = 0; i < queue.length && busy.all < CAP; ) {
      const s = queue[i];
      if (busy[s.provider] >= PCAP[s.provider]) { i++; continue; }
      queue.splice(i, 1); busy.all++; busy[s.provider]++;
      one(s).catch(e => log("ERROR " + s.runId + " " + e.message)).finally(() => { busy.all--; busy[s.provider]--; pump(); });
    }
    if (!queue.length && !busy.all) done();
  };
  pump();
});
log("fleet done");
