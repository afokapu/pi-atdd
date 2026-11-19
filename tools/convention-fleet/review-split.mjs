import { readdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET, runPi, usageOf } from "./lib.mjs";
const D = join(FLEET, "runs-split"); const ids = readdirSync(D).filter(d => !existsSync(join(D, d, "split-review.json")));
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(FLEET, "split.log"), l + "\n"); };
let busy = 0; const q = [...ids];
await new Promise(fin => { const pump = () => { while (busy < 5 && q.length) { const id = q.shift(); busy++;
  runPi({ cwd: join(D, id), provider: "kimi-coding", model: "k3.1-pro", thinking: "medium", tools: "read,write,ls", prompt: readFileSync(join(FLEET, "SPLIT_REVIEWER.md"), "utf8"), out: join(D, id, "split-review.jsonl") })
   .then(() => { let v = null; try { v = JSON.parse(readFileSync(join(D, id, "split-review.json"), "utf8")); } catch {} log(id + " split-review=" + (v?.reviewerVerdict ?? "UNPARSED") + " agree=" + v?.agreeWithAuditor + " usability=" + (v?.parts ?? []).map(p => p.usability).join("/") + " pi$" + usageOf(join(D, id, "split-review.jsonl")).cost.toFixed(3)); busy--; pump(); }); }
  if (!q.length && !busy) fin(); }; pump(); });
