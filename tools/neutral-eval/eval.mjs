// PLT-84 evaluation driver: Bun regression (0.2.0 vs new) and second-stack arms (A none, B core+profile, C core+profile+Bun reference).
// node eval.mjs prepare|validate|run|report   (EVAL_DIR defaults to ~/forge-evidence/pi-atdd/plt-84/eval)
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runPi, summarizeEvents, sha256 } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname, REPO = join(HERE, "../..");
const E = process.env.EVAL_DIR || join(homedir(), "forge-evidence/pi-atdd/plt-84/eval");
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const sh = (cmd, args, cwd, extra = {}) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 26, ...extra });
const MODELS = { glm: { provider: "zai", model: "glm-5.3", thinking: "low" }, kimi: { provider: "kimi-coding", model: "kimi-for-coding", thinking: "low" } };
const TARGET = { "R-AUTH": { v020: "coder.bun.security-missing-auth", new: "coder.security.missing-auth", hex: "coder.security.missing-auth" },
  "R-ARCH": { v020: "coder.bun.design-hierarchy-import", new: "coder.architecture.hierarchy-import", hex: "coder.architecture.hierarchy-import" } };
const PROMPT = (t, conventions) => (conventions ? "The team's engineering conventions that apply to this task follow. Apply them.\n\n" + conventions + "\n\n=== TASK ===\n" : "") +
  `You are a coding agent working in this repository (a disposable checkout of a small TypeScript service; read README.md for its layering). Complete task ${t.taskId}.\n\n${t.task}\n\nAcceptance ${t.acceptanceId}:\n${t.gwt}\n\nYou may change ONLY these files: ${t.allowedPaths.join(", ")}. Do not modify, add or delete tests, test helpers or any other file, and do not commit. Run the acceptance test with: node --test ${t.visibleTests.join(" ")}\n\nWhen finished, reply with a short report: what you changed, the test result, and any concerns about whether the acceptance is truly satisfied.`;

/** Run node:test on files; top-level TAP lines give per-test pass/fail. */
export function runTests(dir, files) {
  let out = "", code = 0;
  try { out = sh("node", ["--test", "--test-reporter=tap", ...files], dir, { timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String(e.stdout ?? ""); code = e.status ?? 1; }
  const tests = [...out.matchAll(/^(not )?ok \d+ - (.*)$/gm)].map(m => ({ name: m[2].replace(/ # .*/, ""), pass: !m[1] }));
  return { code, passed: tests.filter(t => t.pass).map(t => t.name), failed: tests.filter(t => !t.pass).map(t => t.name), total: tests.length };
}
const copyTree = (src, dst) => { mkdirSync(dst, { recursive: true }); cpSync(src, dst, { recursive: true }); };
function mkBase(dir, srcDirs) { rmSync(dir, { recursive: true, force: true }); for (const s of srcDirs) copyTree(s, dir);
  sh("git", ["init", "-q"], dir); sh("git", ["add", "-A"], dir); sh("git", ["-c", "user.name=h", "-c", "user.email=h@example.invalid", "commit", "-qm", "base"], dir); return sh("git", ["rev-parse", "HEAD"], dir).trim(); }

function prepare() {
  const A = join(E, "author");
  // Bun-layout base = fixture + delta; tasks as authored.
  copyTree(join(A, "fixture"), join(E, "src-bun")); copyTree(join(A, "delta"), join(E, "src-bun"));
  sh("node", [join(HERE, "port-hexagon.mjs"), join(E, "src-bun"), join(E, "src-hex")], REPO);
  writeFileSync(join(E, "src-hex/README.md"), "# orders-service\n\nSmall TypeScript service (Node >= 22, type stripping, no dependencies).\n\nLayering inside each bounded context (`src/<context>/`):\n\n- `core/` — pure business rules. Depends on nothing outside its own `core/`.\n- `usecases/` — use cases; composes core with adapters.\n- `adapters/` — adapters to storage and remote configuration.\n- `http/` — HTTP handlers, registered on `src/server/router.ts`.\n\nBounded contexts: `orders`, `pricing`, `shipping`, `loyalty`.\n\nRun tests: `npm test` (or `node --test \"tests/**/*.test.ts\"`)\n");
  // Oracles, references and tasks for both layouts.
  for (const [name, root] of [["bun", A], ["hex", null]]) {
    const dst = join(E, name);
    rmSync(dst, { recursive: true, force: true }); mkdirSync(dst, { recursive: true });
    if (name === "bun") { copyTree(join(A, "oracle"), join(dst, "oracle")); copyTree(join(A, "references"), join(dst, "references")); cpSync(join(A, "tasks.json"), join(dst, "tasks.json")); }
    else for (const d of ["oracle", "references"]) sh("node", [join(HERE, "port-hexagon.mjs"), join(E, "bun", d), join(dst, d)], REPO);
    if (name === "hex") writeFileSync(join(dst, "tasks.json"), JSON.stringify(portTasks(J(join(E, "bun/tasks.json"))), null, 2));
  }
  const snap = join(E, "snap"); mkdirSync(snap, { recursive: true });
  const newSha = process.env.NEW_SHA; if (!newSha) throw new Error("set NEW_SHA to the pi-atdd commit under test");
  for (const [k, rev] of [["v020", "v0.2.0-bun-baseline"], ["new", newSha]]) {
    rmSync(join(snap, k), { recursive: true, force: true }); mkdirSync(join(snap, k), { recursive: true });
    execFileSync("sh", ["-c", `git -C ${join(homedir(), "Github/pi-atdd")} archive ${rev} | tar -x -C ${join(snap, k)}`]);
    execFileSync("ln", ["-s", join(REPO, "node_modules"), join(snap, k, "node_modules")]);
  }
  sh("node", ["--experimental-strip-types", join(HERE, "render-conventions.ts"), join(HERE, "ts-hexagon.eval.profile.json"), join(E, "hex/tasks.json"), join(E, "hex/conventions")], REPO, { stdio: ["ignore", "inherit", "inherit"] });
  console.log("prepared; new=" + newSha);
}
const SEG = (s) => s.replaceAll("/http/", "/server/").replaceAll("/routes/", "/http/").replaceAll("/domain/", "/core/").replaceAll("/application/", "/usecases/").replaceAll("/integration/", "/adapters/");
const portTasks = (t) => JSON.parse(SEG(JSON.stringify(t)));

function validate() {
  const out = {};
  for (const stack of ["bun", "hex"]) {
    const base = join(E, "src-" + stack), tasks = J(join(E, stack, "tasks.json")).tasks;
    for (const t of tasks) {
      const row = out[stack + ":" + t.taskId] = {};
      const oracle = [join(E, stack, "oracle", t.taskId + ".oracle.test.ts")];
      const run = (refDir) => { const ws = join("/tmp", "plt84-val-" + stack + "-" + t.taskId); const sha = mkBase(ws, [base]);
        if (refDir) copyTree(refDir, ws);
        mkdirSync(join(ws, "tests/_oracle"), { recursive: true }); cpSync(oracle[0], join(ws, "tests/_oracle", t.taskId + ".oracle.test.ts"));
        const v = runTests(ws, t.visibleTests), o = runTests(ws, ["tests/_oracle/" + t.taskId + ".oracle.test.ts"]); rmSync(ws, { recursive: true, force: true }); return { visiblePass: v.code === 0 && v.total > 0, oraclePass: o.code === 0 && o.total > 0, oracleFailed: o.failed }; };
      row.base = run(null);
      for (const ref of readdirSync(join(E, stack, "references", t.taskId))) row[ref] = run(join(E, stack, "references", t.taskId, ref));
      const okBase = !row.base.visiblePass, okCorrect = row.correct?.visiblePass && row.correct?.oraclePass;
      const okNaive = Object.entries(row).filter(([k]) => k.startsWith("naive")).every(([, r]) => r.visiblePass && !r.oraclePass);
      row.valid = Boolean(okBase && okCorrect && okNaive);
    }
  }
  writeFileSync(join(E, "validation-mine.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(Object.entries(out).map(([k, v]) => k + " " + (v.valid ? "VALID" : "INVALID")).join("\n"));
}

const QUOTA_RE = /insufficient (balance|quota)|quota (exceeded|exhausted)|usage limit|out of credits|billing|\b1113\b|resource package|weekly limit|monthly limit/i;
const RATE_RE = /\b429\b|rate.?limit|too many requests|\b1302\b/i;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function trial(spec, log) {
  const dir = join(E, "runs", spec.id); mkdirSync(dir, { recursive: true });
  const tasks = J(join(E, spec.stack, "tasks.json")).tasks, t = tasks.find(x => x.taskId === spec.task);
  const ws = join(dir, "ws"), baseSha = mkBase(ws, [join(E, "src-" + spec.stack)]);
  let conventions = "", extension;
  if (spec.stack === "bun") extension = join(E, "snap", spec.arm, "extensions/atdd.ts");
  else if (spec.arm !== "A") conventions = readFileSync(join(E, "hex/conventions", t.taskId + "." + spec.arm + ".md"), "utf8");
  const prompt = PROMPT(t, conventions); writeFileSync(join(dir, "prompt.txt"), prompt);
  const m = MODELS[spec.model];
  const run = await runPi({ cwd: ws, outJsonl: join(dir, "coder.jsonl"), outStderr: join(dir, "coder.stderr"), timeoutMs: 20 * 60_000, ...m, prompt, extension });
  const raw = readFileSync(join(dir, "coder.jsonl"), "utf8"); const { events_, ...s } = summarizeEvents(raw);
  const n429 = (raw.match(/Rate limit reached|\b429:/g) ?? []).length, errText = s.errorMessages.join(" | ") + " " + readFileSync(join(dir, "coder.stderr"), "utf8").slice(-400);
  // Graph activation audit (bun arms): did the target rule reach the model before the first successful edit?
  const tid = TARGET[t.target][spec.stack === "hex" ? "hex" : spec.arm];
  const text = (e) => JSON.stringify(e.result ?? e.message?.content ?? "");
  const deliveredAt = events_.findIndex(e => (e.type === "tool_execution_end" || e.type === "message_end") && text(e).includes("Convention " + tid + " —"));
  const delivered = [...new Set(events_.flatMap(e => [...text(e).matchAll(/Convention ([a-z0-9_.-]+) —/g)].map(x => x[1])))];
  // Integrity + scoring.
  sh("git", ["add", "-A"], ws);
  const changed = sh("git", ["diff", "--cached", "--name-only", baseSha], ws).split("\n").filter(Boolean);
  writeFileSync(join(dir, "result.diff"), sh("git", ["diff", "--cached", baseSha], ws));
  const unauthorized = changed.filter(p => !t.allowedPaths.includes(p));
  const vis = runTests(ws, t.visibleTests);
  mkdirSync(join(ws, "tests/_oracle"), { recursive: true }); cpSync(join(E, spec.stack, "oracle", t.taskId + ".oracle.test.ts"), join(ws, "tests/_oracle", t.taskId + ".oracle.test.ts"));
  const orc = runTests(ws, ["tests/_oracle/" + t.taskId + ".oracle.test.ts"]);
  const failedProvider = s.toolExecuted === 0 && (s.stop === "error" || run.timedOut === false && s.turns === 0);
  const rec = { schema: "pi-atdd/plt84-eval-trial/v1", ...spec, baseSha, promptSha256: sha256(prompt), run, n429, coder: s,
    delivered, targetRule: tid, targetDeliveredAt: deliveredAt, firstEditIndex: s.firstEditIndex,
    targetBeforeFirstEdit: spec.arm === "A" ? null : (spec.stack === "hex" ? true : deliveredAt >= 0 && (s.firstEditIndex < 0 || deliveredAt < s.firstEditIndex)),
    changed, unauthorized, visible: { pass: vis.code === 0 && vis.total > 0, ...vis }, oracle: { pass: orc.code === 0 && orc.total > 0, passed: orc.passed.length, total: orc.total, failed: orc.failed },
    accepted: unauthorized.length === 0 && vis.code === 0 && vis.total > 0 && orc.code === 0 && orc.total > 0, costUsd: s.usage.cost,
    status: failedProvider ? "INVALID_PROVIDER_FAILURE" : "VALID", providerError: failedProvider ? errText.slice(0, 400) : undefined };
  rmSync(join(ws, "tests/_oracle"), { recursive: true, force: true });
  writeFileSync(join(dir, "trial.json"), JSON.stringify(rec, null, 2) + "\n");
  rec.exhausted = QUOTA_RE.test(errText); rec.rateLimited = RATE_RE.test(errText);
  return rec;
}

function schedule() {
  const tasks = J(join(E, "bun/tasks.json")).tasks.map(t => t.taskId), reps = Number(process.env.REPS || 3);
  const specs = [];
  for (const task of tasks) for (const model of Object.keys(MODELS)) for (let r = 1; r <= reps; r++) {
    for (const arm of ["v020", "new"]) specs.push({ id: `bun-${arm}-${task}-${model}-r${r}`, stack: "bun", arm, task, model, rep: r });
    for (const arm of ["A", "B", "C"]) specs.push({ id: `hex-${arm}-${task}-${model}-r${r}`, stack: "hex", arm, task, model, rep: r });
  }
  let seed = 84; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return specs.map(s => [rnd(), s]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

async function runAll() {
  const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(E, "eval.log"), l + "\n"); };
  const specs = schedule(); writeFileSync(join(E, "schedule.json"), JSON.stringify(specs, null, 2));
  const pending = specs.filter(s => !existsSync(join(E, "runs", s.id, "trial.json")));
  log("schedule " + specs.length + ", pending " + pending.length);
  const cap = { glm: 3, kimi: 3 }, busy = { glm: 0, kimi: 0 }, clean = { glm: 0, kimi: 0 }, pauseUntil = { glm: 0, kimi: 0 };
  let stop = null; const costs = {};
  const q = [...pending]; let active = 0;
  await new Promise(fin => {
    const pump = () => {
      if (stop || !q.length) { if (!active) fin(); return; }
      for (let i = 0; i < q.length && !stop; i++) {
        const s = q[i]; if (busy[s.model] >= cap[s.model] || Date.now() < pauseUntil[s.model]) continue;
        q.splice(i, 1); i--; busy[s.model]++; active++;
        (async () => {
          try {
            let rec = await trial(s, log);
            if (rec.status !== "VALID") { // one retry as a new attempt after a pause; both attempts are kept
              log("INVALID " + s.id + ": " + rec.providerError?.slice(0, 120));
              if (rec.exhausted) { stop = s.id + " quota exhausted: " + rec.providerError; return; }
              pauseUntil[s.model] = Date.now() + 90_000; await sleep(90_000);
              rmSync(join(E, "runs", s.id + "-attempt1"), { recursive: true, force: true });
              execFileSync("mv", [join(E, "runs", s.id), join(E, "runs", s.id + "-attempt1")]);
              rec = await trial(s, log);
              if (rec.status !== "VALID") { stop = s.id + " failed twice (provider): " + rec.providerError; return; }
            }
            if (rec.n429) { clean[s.model] = 0; cap[s.model] = Math.max(1, cap[s.model] - 1); log("ADAPT " + s.model + " cap -> " + cap[s.model] + " (429)"); }
            else if (++clean[s.model] >= 6 && cap[s.model] < 5) { clean[s.model] = 0; cap[s.model]++; log("ADAPT " + s.model + " cap -> " + cap[s.model]); }
            costs[s.model] = (costs[s.model] || 0) + rec.costUsd;
            log(`${s.id} accepted=${rec.accepted} visible=${rec.visible.pass} oracle=${rec.oracle.passed}/${rec.oracle.total} unauth=${rec.unauthorized.length} cost=$${rec.costUsd.toFixed(3)} wall=${Math.round(rec.run.wallMs / 1000)}s targetBefore=${rec.targetBeforeFirstEdit}`);
          } catch (e) { log("ERROR " + s.id + ": " + e.message); }
          finally { busy[s.model]--; active--; pump(); }
        })();
      }
      if (!active && (!q.length || stop)) fin();
    };
    setInterval(pump, 5000).unref(); pump();
  });
  if (stop) { log("STOPPED: " + stop); process.exit(3); }
  log("all runs done");
}

const cmd = process.argv[2];
if (cmd === "prepare") prepare(); else if (cmd === "validate") validate(); else if (cmd === "run") await runAll();
else console.log("usage: node eval.mjs prepare|validate|run");
