/**
 * PLT-79 scheduler: dispatch preregistered coder trials in schedule order with
 * bounded concurrency, and evaluate each finished trial (pipelined). Trials and
 * evaluations already present are skipped (never re-run in place).
 * Usage: node run-all.mjs <E> [--coders 4] [--evaluators 3] [--only w001,w002]
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const args = process.argv.slice(2);
const [E] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const coders = Number(opt("--coders", 4)), evaluators = Number(opt("--evaluators", 3));
const only = opt("--only", null)?.split(",");
const prereg = JSON.parse(readFileSync(join(HERE, "../prereg.json"), "utf8"));
const log = (m) => { const line = new Date().toISOString() + " " + m; console.log(line); appendFileSync(join(E, "run-log.txt"), line + "\n"); };
const sh = (script, a) => new Promise(done => {
  const c = spawn(process.execPath, [join(HERE, script), ...a], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  c.stdout.on("data", d => out += d); c.stderr.on("data", d => err += d);
  c.on("close", code => done({ code, out: out.trim().split("\n").at(-1), err: err.trim().split("\n").slice(-3).join(" | ") }));
});
const queue = prereg.schedule.filter(s => !only || only.includes(s.trialId));
const evalQueue = [];
let codersBusy = 0, evalBusy = 0, coderDone = false;
for (const s of queue) if (existsSync(join(E, "trials", s.trialId, "trial.json")) && !existsSync(join(E, "trials", s.trialId, "evaluation.json"))) evalQueue.push(s);
const pending = queue.filter(s => !existsSync(join(E, "trials", s.trialId)));
log("scheduler start: " + pending.length + " coder trials pending, " + evalQueue.length + " evaluations pending");
await new Promise(finish => {
  const pump = () => {
    while (codersBusy < coders && pending.length) {
      const s = pending.shift(); codersBusy++;
      log("coder start " + s.trialId + " seq=" + s.seq + " " + s.unit + " " + s.condition);
      sh("run-trial.mjs", [E, s.trialId]).then(r => {
        codersBusy--;
        log("coder end " + s.trialId + " code=" + r.code + " " + (r.code === 0 ? r.out : "ERR " + r.err));
        if (r.code === 0) evalQueue.push(s);
        pump();
      });
    }
    if (!pending.length && codersBusy === 0) coderDone = true;
    while (evalBusy < evaluators && evalQueue.length) {
      const s = evalQueue.shift(); evalBusy++;
      log("eval start " + s.trialId);
      sh("evaluate-trial.mjs", [E, s.trialId]).then(r => {
        evalBusy--;
        log("eval end " + s.trialId + " code=" + r.code + " " + (r.code === 0 ? r.out : "ERR " + r.err));
        pump();
      });
    }
    if (coderDone && evalBusy === 0 && !evalQueue.length) finish();
  };
  pump();
});
log("scheduler done");
