// PLT-84 evaluation report: node report.mjs  -> prints markdown tables, writes results.json next to the runs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const E = process.env.EVAL_DIR || join(homedir(), "forge-evidence/pi-atdd/plt-84/eval"), R = join(E, "runs");
const trials = readdirSync(R).filter(d => !d.includes("attempt")).map(d => { try { return JSON.parse(readFileSync(join(R, d, "trial.json"), "utf8")); } catch { return null; } }).filter(Boolean);
const rate = (xs) => xs.length ? xs.filter(t => t.accepted).length / xs.length : NaN, f = (x) => Number.isNaN(x) ? "n/a" : x.toFixed(2);
const frac = (xs) => xs.filter(t => t.accepted).length + "/" + xs.length;
const cost = (xs) => xs.reduce((s, t) => s + t.costUsd, 0);
// two-sided Fisher exact (descriptive only)
const lf = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const hyp = (a, b, c, d) => Math.exp(lf(a + b) + lf(c + d) + lf(a + c) + lf(b + d) - lf(a + b + c + d) - lf(a) - lf(b) - lf(c) - lf(d));
const fisher = (a, n1, c, n2) => { const k = a + c, p0 = hyp(a, n1 - a, c, n2 - c); let p = 0; for (let x = Math.max(0, k - n2); x <= Math.min(n1, k); x++) { const q = hyp(x, n1 - x, k - x, n2 - (k - x)); if (q <= p0 + 1e-12) p += q; } return Math.min(1, p); };
const out = {}, lines = [];
const by = (stack, arm) => trials.filter(t => t.stack === stack && t.arm === arm);
const section = (title, stack, arms) => {
  lines.push("### " + title, "", "| Arm | Accepted | Rate | Cost total | Cost / run | Valid | Wall s / run |", "| -- | -- | -- | -- | -- | -- | -- |");
  for (const a of arms) { const xs = by(stack, a); out[stack + ":" + a] = { n: xs.length, accepted: xs.filter(t => t.accepted).length, cost: cost(xs) };
    lines.push(`| ${a} | ${frac(xs)} | ${f(rate(xs))} | $${cost(xs).toFixed(2)} | $${(cost(xs) / xs.length).toFixed(3)} | ${xs.filter(t => t.status === "VALID").length}/${xs.length} | ${Math.round(xs.reduce((s, t) => s + t.run.wallMs, 0) / xs.length / 1000)} |`); }
  lines.push("");
  for (const [dim, key] of [["Per model", t => t.model], ["Per task", t => t.task]]) {
    const keys = [...new Set(trials.filter(t => t.stack === stack).map(key))].sort();
    lines.push("| " + dim + " | " + arms.join(" | ") + " |", "| -- | " + arms.map(() => "--").join(" | ") + " |");
    for (const k of keys) lines.push("| " + k + " | " + arms.map(a => frac(by(stack, a).filter(t => key(t) === k))).join(" | ") + " |");
    lines.push("");
  }
  // oracle trap-level: failed oracle test names per arm
  const names = [...new Set(trials.filter(t => t.stack === stack).flatMap(t => t.oracle.failed.map(n => n.split(":")[0])))].sort();
  lines.push("Failed oracle checks by trap (count of runs failing it):", "", "| Trap | " + arms.join(" | ") + " |", "| -- | " + arms.map(() => "--").join(" | ") + " |");
  for (const n of names) lines.push("| " + n + " | " + arms.map(a => by(stack, a).filter(t => t.oracle.failed.some(x => x.startsWith(n))).length).join(" | ") + " |");
  lines.push("");
};
section("Bun regression (SN-001): 0.2.0 vs new", "bun", ["v020", "new"]);
section("Second stack (ts-hexagon): A none, B core+profile, C core+profile+Bun reference", "hex", ["A", "B", "C"]);
const cmp = (stack, a, b) => { const x = by(stack, a), y = by(stack, b); const d = rate(y) - rate(x); const p = fisher(x.filter(t => t.accepted).length, x.length, y.filter(t => t.accepted).length, y.length); return { a, b, d, p }; };
lines.push("### Differences (second arm minus first)", "", "| Comparison | D | Fisher p (descriptive) | Rule result |", "| -- | -- | -- | -- |");
for (const [s, a, b, up, down] of [["bun", "v020", "new", "NO REGRESSION", "REGRESSION"], ["hex", "B", "C", "C beats B", "B beats C"], ["hex", "A", "B", "B beats A", "A beats B"], ["hex", "A", "C", "C beats A", "A beats C"]]) {
  const c = cmp(s, a, b); out["diff:" + s + ":" + a + "-" + b] = c;
  const verdict = s === "bun" ? (c.d <= -0.15 ? down : up) : (c.d >= 0.15 ? up : c.d <= -0.15 ? down : "NO DIFFERENCE");
  lines.push(`| ${s} ${a} → ${b} | ${c.d >= 0 ? "+" : ""}${c.d.toFixed(3)} | ${c.p.toFixed(2)} | ${verdict} |`);
}
const bunNew = by("bun", "new"), bunOld = by("bun", "v020");
lines.push("", "Bun activation audit (target rule reached the model before the first edit): v020 " + bunOld.filter(t => t.targetBeforeFirstEdit).length + "/" + bunOld.length + ", new " + bunNew.filter(t => t.targetBeforeFirstEdit).length + "/" + bunNew.length + ".",
  "Unauthorized paths changed: " + trials.filter(t => t.unauthorized.length).length + " runs. Invalid runs: " + trials.filter(t => t.status !== "VALID").length + ". Total notional cost: $" + cost(trials).toFixed(2) + " over " + trials.length + " runs.");
writeFileSync(join(E, "results.json"), JSON.stringify(out, null, 2) + "\n"); writeFileSync(join(E, "RESULTS.md"), lines.join("\n") + "\n"); console.log(lines.join("\n"));
