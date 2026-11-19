// Third-party spot-check review: every FAIL + a seeded 10% sample of PASS (+ the pilot set),
// reviewed by kimi-coding/k3.1-pro (a provider different from author and auditor).
// Usage: node review.mjs [--concurrency 4]
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET, runPi, usageOf } from "./lib.mjs";

const conc = Number(process.argv[process.argv.indexOf("--concurrency") + 1] || 4);
const RUNS = join(FLEET, "runs");
const REVIEWER = { provider: "kimi-coding", model: "k3.1-pro", thinking: "medium", tools: "read,write,ls" };
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(FLEET, "review.log"), l + "\n"); };
const done = readdirSync(RUNS).filter(d => existsSync(join(RUNS, d, "result.json"))).sort();
const status = Object.fromEntries(done.map(d => [d, JSON.parse(readFileSync(join(RUNS, d, "result.json"), "utf8")).status]));
const pilot = readFileSync(join(FLEET, "pilot.txt"), "utf8").split(/\s+/).filter(Boolean);
let seed = 0x80080; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const passes = done.filter(d => status[d] === "PASS" && !pilot.includes(d)).map(d => [rand(), d]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const onlyArg = process.argv.indexOf("--only");
const sample = onlyArg > 0 ? readFileSync(process.argv[onlyArg + 1], "utf8").split(/\s+/).filter(Boolean) : [...new Set([...done.filter(d => status[d] !== "PASS"), ...pilot.filter(p => done.includes(p)), ...passes.slice(0, Math.ceil(passes.length * 0.1))])];
if (onlyArg < 0) writeFileSync(join(FLEET, "review-sample.json"), JSON.stringify({ rule: "all non-PASS + pilot set + seeded 10% of other PASS (seed 0x80080)", sample }, null, 2));
log("review start: " + sample.length + " conventions");
const queue = sample.filter(d => !existsSync(join(RUNS, d, "review.json")));
let busy = 0;
await new Promise(fin => {
  const pump = () => {
    while (busy < conc && queue.length) {
      const id = queue.shift(); busy++;
      const dir = join(RUNS, id);
      runPi({ cwd: dir, ...REVIEWER, prompt: readFileSync(join(FLEET, "REVIEWER.md"), "utf8"), out: join(dir, "review.jsonl") }).then(() => {
        const u = usageOf(join(dir, "review.jsonl"));
        let v = null; try { v = JSON.parse(readFileSync(join(dir, "review.json"), "utf8")); } catch {}
        log(id + " review=" + (v?.reviewerVerdict ?? "UNPARSED") + " agree=" + v?.agreeWithAuditor + " usability=" + v?.usability?.score + " $" + u.cost.toFixed(3));
        busy--; pump();
      });
    }
    if (!queue.length && !busy) fin();
  };
  pump();
});
log("review done");
