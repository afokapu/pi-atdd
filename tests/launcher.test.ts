// URN: test:pi-atdd:launcher:ATD-36
// Acceptance: acc:pi-atdd:atd-36-a04
// Acceptance: acc:pi-atdd:atd-36-a05
// Acceptance: acc:pi-atdd:atd-36-a06
// Acceptance: acc:pi-atdd:atd-36-a07
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { attentionSeatOptions } from "../src/attention-seat.ts";
import { executionConfigFromEnv, readSeatLease, REQUIRED_EXECUTION_VARIABLES } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";
import { bootstrapSeatFromEnv } from "../src/seat-bootstrap.ts";
import { defaultDeps, LaunchRefused, planLaunch, type LaunchInput } from "../src/launcher.ts";

const REPO = new URL("..", import.meta.url).pathname;
// The host shell may itself be a governed session; launch tests must not inherit its ATDD variables.
const hostEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith("PI_ATDD_ATTENTION_") && !k.startsWith("PI_ATDD_EXECUTION_") && k !== "PI_ATDD_MODE"));
const world = () => {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-launch-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};
const coachInput = (root: string): LaunchInput => ({
  role: "coach", label: "Coach A", profile: "af8", project: "pi-atdd", coach: "coach:af8/pi-atdd",
  agentDir: root, model: "pi-claude-cli/claude-haiku-5-5",
});
const ctxFor = (session: string) => ({
  cwd: "/tmp", isProjectTrusted: () => true, model: { provider: "p", id: "m" },
  sessionManager: { getSessionId: () => session, getBranch: () => [] },
  ui: { notify: () => {}, setWidget: () => {} },
});
const toolsFor = (env: NodeJS.ProcessEnv) => {
  const tools = new Map<string, any>();
  const seat = registerSeatExecution({ on: () => {}, registerCommand: () => {} } as any, env);
  registerAttentionStrip({ on: () => {}, registerTool: (d: any) => tools.set(d.name, d),
    registerCommand: () => {}, appendEntry: () => {} } as any, {
    env, now: () => new Date("2026-11-22T10:00:00Z"), ...attentionSeatOptions(seat),
  });
  return tools;
};

test("ATD-36 A04: a coach from the extension launcher has profile, mode, role, identity, route and a generation-1 seat, and is authorized", async () => {
  const w = world();
  try {
    const plan = planLaunch(coachInput(w.root));
    assert.equal(plan.env.PI_ATDD_ATTENTION_ROLE, "coach");
    assert.equal(plan.env.PI_ATDD_ATTENTION_IDENTITY, "Coach A");
    assert.equal(plan.env.PI_ATDD_ATTENTION_PROFILE, "af8");
    assert.equal(plan.env.PI_ATDD_EXECUTION_MODE, "standalone");
    assert.equal(plan.env.PI_ATDD_EXECUTION_TASK_ID, "*");
    assert.equal(plan.env.PI_ATDD_EXECUTION_GENERATION, "1");
    assert.equal(plan.env.PI_ATDD_EXECUTION_MODEL_ID, "pi-claude-cli/claude-haiku-5-5", "MODEL_ID is provider/model");
    const bound = bootstrapSeatFromEnv(plan.env);
    assert.equal(bound.generation, 1);
    assert.equal(bound.sessionId, plan.sessionId);
    const result = await toolsFor(plan.env).get("attention_list").execute("call", {}, undefined, undefined, ctxFor(plan.sessionId));
    assert.ok(Array.isArray(result.details.items));
  } finally { w.cleanup(); }
});

test("ATD-36 A04: a worker's attention route and seat share one execution id, and the worker is authorized", async () => {
  const w = world();
  try {
    const plan = planLaunch({ ...coachInput(w.root), role: "worker", label: "Worker One", task: "ATD-40" });
    assert.equal(plan.env.PI_ATDD_ATTENTION_EXECUTION_ID, plan.env.PI_ATDD_EXECUTION_EXECUTION_ID);
    assert.equal(plan.env.PI_ATDD_EXECUTION_TASK_ID, "ATD-40");
    bootstrapSeatFromEnv(plan.env);
    const raised = await toolsFor(plan.env).get("attention_raise").execute("call",
      { type: "decision", summary: "launch check" }, undefined, undefined, ctxFor(plan.sessionId));
    assert.ok(raised.details.id, "worker is authorized to raise");
  } finally { w.cleanup(); }
});

test("ATD-36 A04: a relaunch with --session FILE keeps the session id from the file header", () => {
  const w = world();
  try {
    const file = join(w.root, "session.jsonl");
    writeFileSync(file, JSON.stringify({ type: "session", id: "sess-kept-1", version: 3 }) + "\n");
    const plan = planLaunch({ ...coachInput(w.root), session: file });
    assert.equal(plan.sessionId, "sess-kept-1");
    assert.equal(plan.env.PI_ATDD_EXECUTION_SESSION_ID, "sess-kept-1");
    assert.deepEqual(plan.piArgs.slice(plan.piArgs.indexOf("--session"), plan.piArgs.indexOf("--session") + 2), ["--session", file]);
    assert.equal(plan.piArgs.includes("--session-id"), false);
  } finally { w.cleanup(); }
});

test("ATD-36 A04: the CLI launch starts pi with the planned session id and a bootstrapped lease (fake pi on PATH)", () => {
  const w = world();
  try {
    const bin = join(w.root, "bin"); mkdirSync(bin);
    const out = join(w.root, "pi-out.txt");
    writeFileSync(join(bin, "pi"), "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PI_TEST_OUT\"\n" +
      "printf '%s\\n' \"$PI_ATDD_EXECUTION_SESSION_ID\" \"$PI_ATDD_EXECUTION_EXECUTION_ID\" \"$PI_ATDD_EXECUTION_GENERATION\" > \"$PI_TEST_OUT.env\"\n");
    chmodSync(join(bin, "pi"), 0o755);
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "launch", "--role", "coach",
      "--label", "Coach A", "--profile", "af8", "--project", "pi-atdd", "--coach", "coach:af8/pi-atdd",
      "--agent-dir", w.root, "--model", "pi-claude-cli/claude-haiku-5-5", "--cwd", w.root],
      { cwd: REPO, encoding: "utf8", env: { ...hostEnv(), PATH: bin + ":" + process.env.PATH, PI_TEST_OUT: out } });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const args = readFileSync(out, "utf8").split("\n");
    const [sessionId, executionId, generation] = readFileSync(out + ".env", "utf8").trim().split("\n");
    assert.equal(args[args.indexOf("--session-id") + 1], sessionId, "pi was started with the planned session id");
    assert.equal(generation, "1");
    const env = { PI_CODING_AGENT_DIR: w.root, PI_ATDD_EXECUTION_MODE: "standalone",
      PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "*",
      PI_ATDD_EXECUTION_COACH_ADDRESS: "coach:af8/pi-atdd", PI_ATDD_EXECUTION_SEAT_ADDRESS: "coach:af8/pi-atdd",
      PI_ATDD_EXECUTION_EXECUTION_ID: executionId, PI_ATDD_EXECUTION_SESSION_ID: sessionId,
      PI_ATDD_EXECUTION_MODEL_ID: "pi-claude-cli/claude-haiku-5-5", PI_ATDD_EXECUTION_GENERATION: "1",
      PI_ATDD_EXECUTION_OWNER_TOKEN: "from-launch" } as NodeJS.ProcessEnv;
    const lease = readSeatLease(executionConfigFromEnv(env)!.leasePath);
    assert.equal(lease?.executionId, executionId, "launch bootstrapped the lease for this execution");
    assert.equal(lease?.sessionId, sessionId);
  } finally { w.cleanup(); }
});

test("ATD-36 A05: a launch missing the route half or the seat half is refused and names what is missing, with no lease written", () => {
  const w = world();
  try {
    assert.throws(() => planLaunch({ ...coachInput(w.root), profile: undefined }),
      (e: Error) => e instanceof LaunchRefused && /attention route[^]*--profile/.test(e.message));
    assert.throws(() => planLaunch({ ...coachInput(w.root), agentDir: undefined }),
      (e: Error) => /execution seat[^]*--agent-dir/.test(e.message));
    assert.throws(() => planLaunch({ ...coachInput(w.root), role: "worker", task: undefined }),
      (e: Error) => /--task/.test(e.message));
    assert.throws(() => planLaunch({ ...coachInput(w.root), profile: undefined, agentDir: undefined }),
      (e: Error) => /--profile/.test(e.message) && /--agent-dir/.test(e.message));
    assert.equal(existsSync(join(w.root, "execution")), false, "a refused launch writes no seat");
  } finally { w.cleanup(); }
});

test("ATD-36 A06: two launches in the same second get different execution ids and owner tokens", () => {
  const w = world();
  try {
    const a = planLaunch(coachInput(w.root), defaultDeps);
    const b = planLaunch(coachInput(w.root), defaultDeps);
    assert.notEqual(a.executionId, b.executionId);
    assert.notEqual(a.env.PI_ATDD_EXECUTION_OWNER_TOKEN, b.env.PI_ATDD_EXECUTION_OWNER_TOKEN);
    assert.match(a.executionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  } finally { w.cleanup(); }
});

test("ATD-36 A05: session_start refuses when the attention route is missing, naming each missing setting, and blocks tools", () => {
  const w = world();
  try {
    const env = { PI_CODING_AGENT_DIR: w.root, PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "Coach A" } as NodeJS.ProcessEnv;
    const handlers = new Map<string, (e: unknown, ctx: any) => unknown>();
    registerSeatExecution({ on: (n: string, cb: any) => handlers.set(n, cb), registerCommand: () => {} } as any, env);
    const notes: Array<[string, string]> = [];
    const ctx = { ...ctxFor("s"), ui: { notify: (m: string, l?: string) => { notes.push([m, String(l)]); }, setWidget: () => {} } };
    handlers.get("session_start")!({}, ctx);
    const refusal = notes.find(([, level]) => level === "error");
    assert.ok(refusal, "session_start reports a refusal");
    for (const name of ["PI_ATDD_ATTENTION_PROFILE", "PI_ATDD_ATTENTION_PROJECT_ID", "PI_ATDD_ATTENTION_COACH_ADDRESS"])
      assert.match(refusal[0], new RegExp(name));
    assert.equal((handlers.get("tool_call")!({ toolName: "bash" }, ctx) as { block?: boolean }).block, true);
  } finally { w.cleanup(); }
});

test("ATD-36 A05: session_start refuses a complete route without a seat, naming every execution variable", () => {
  const w = world();
  try {
    const env = { ...planLaunch(coachInput(w.root)).env };
    for (const name of REQUIRED_EXECUTION_VARIABLES) delete env[name];
    const handlers = new Map<string, (e: unknown, ctx: any) => unknown>();
    registerSeatExecution({ on: (n: string, cb: any) => handlers.set(n, cb), registerCommand: () => {} } as any, env);
    const notes: Array<[string, string]> = [];
    const ctx = { ...ctxFor("s"), ui: { notify: (m: string, l?: string) => { notes.push([m, String(l)]); }, setWidget: () => {} } };
    handlers.get("session_start")!({}, ctx);
    const refusal = notes.find(([, level]) => level === "error");
    assert.ok(refusal);
    for (const name of REQUIRED_EXECUTION_VARIABLES) assert.match(refusal[0], new RegExp(name));
    assert.doesNotMatch(refusal[0], /PI_ATDD_ATTENTION_PROFILE/, "a complete route is not named as missing");
  } finally { w.cleanup(); }
});

test("ATD-36 A04: a coach may start a worker or reviewer of its own project and coach, and nothing else", () => {
  const w = world();
  try {
    const coachEnv = { ...planLaunch(coachInput(w.root)).env };
    const worker = { ...coachInput(w.root), role: "worker", label: "W", task: "ATD-40" };
    assert.doesNotThrow(() => planLaunch(worker, defaultDeps, coachEnv));
    assert.doesNotThrow(() => planLaunch({ ...worker, role: "reviewer", label: "R" }, defaultDeps, coachEnv));
    assert.throws(() => planLaunch(coachInput(w.root), defaultDeps, coachEnv), /coach may start only workers and reviewers/);
    assert.throws(() => planLaunch({ ...worker, project: "other" }, defaultDeps, coachEnv), /own project and coach/);
    assert.throws(() => planLaunch({ ...worker, coach: "coach:af8/other" }, defaultDeps, coachEnv), /own project and coach/);
    assert.throws(() => planLaunch(worker, defaultDeps, { ...coachEnv, PI_ATDD_ATTENTION_ROLE: "worker" }), /only a coach may start/);
  } finally { w.cleanup(); }
});

test("ATD-36 A07: the dry run prints a plan that never shows the owner token", () => {
  const w = world();
  try {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "launch", "--dry-run",
      "--role", "worker", "--label", "Worker One", "--task", "ATD-40", "--profile", "af8", "--project", "pi-atdd",
      "--coach", "coach:af8/pi-atdd", "--agent-dir", w.root, "--model", "pi-claude-cli/claude-haiku-5-5"],
      { cwd: REPO, encoding: "utf8", env: hostEnv() });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const plan = JSON.parse(run.stdout);
    assert.equal(plan.status, "planned");
    assert.equal(plan.env.PI_ATDD_EXECUTION_OWNER_TOKEN, "<redacted>");
    assert.doesNotMatch(run.stdout, /PI_ATDD_EXECUTION_OWNER_TOKEN": "[0-9a-f]{8}/);
    assert.equal(existsSync(join(w.root, "execution")), false, "a dry run writes no lease");
  } finally { w.cleanup(); }
});

test("ATD-36 A07: the launch rule and the AF8 stopgap are written down", () => {
  const doc = readFileSync(join(REPO, "docs", "ATD-36-SEAT-BOOTSTRAP.md"), "utf8");
  assert.match(doc, /never bare `pi`/);
  assert.match(doc, /atdd launch/);
  assert.match(doc, /stopgap/);
});
