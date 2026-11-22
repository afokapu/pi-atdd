// URN: test:pi-atdd:launcher:ATD-36
// Acceptance: acc:pi-atdd:ATD-36-A04
// Acceptance: acc:pi-atdd:ATD-36-A05
// Acceptance: acc:pi-atdd:ATD-36-A06
// Acceptance: acc:pi-atdd:ATD-36-A07
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { attentionSeatOptions } from "../src/attention-seat.ts";
import { executionConfigFromEnv, readSeatLease } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";
import { bootstrapSeatFromEnv } from "../src/seat-bootstrap.ts";
import { defaultDeps, LaunchRefused, planLaunch, type LaunchInput } from "../src/launcher.ts";

const REPO = new URL("..", import.meta.url).pathname;
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
    const result = await toolsFor(plan.env).get("attention_list").execute("call", {}, undefined, undefined, ctxFor(plan.sessionId));
    assert.ok(Array.isArray(result.details.items));
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
      "printf '%s\\n' \"$PI_ATDD_EXECUTION_SESSION_ID\" \"$PI_ATDD_EXECUTION_EXECUTION_ID\" \"$PI_ATDD_EXECUTION_GENERATION\" >> \"$PI_TEST_OUT\"\n");
    chmodSync(join(bin, "pi"), 0o755);
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "launch", "--role", "coach",
      "--label", "Coach A", "--profile", "af8", "--project", "pi-atdd", "--coach", "coach:af8/pi-atdd",
      "--agent-dir", w.root, "--model", "pi-claude-cli/claude-haiku-5-5", "--cwd", w.root],
      { cwd: REPO, encoding: "utf8", env: { ...process.env, PATH: bin + ":" + process.env.PATH, PI_TEST_OUT: out } });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const [args, sessionId, executionId, generation] = readFileSync(out, "utf8").trim().split("\n");
    const at = args!.split("\n").indexOf("--session-id");
    assert.ok(at >= 0, "pi was started with --session-id");
    const lines = readFileSync(out, "utf8").split("\n");
    assert.equal(lines[lines.indexOf("--session-id") + 1], sessionId);
    assert.equal(generation, "1");
    const env = { ...process.env, PI_CODING_AGENT_DIR: w.root, PI_ATDD_EXECUTION_MODE: "standalone",
      PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "*",
      PI_ATDD_EXECUTION_COACH_ADDRESS: "coach:af8/pi-atdd", PI_ATDD_EXECUTION_SEAT_ADDRESS: "coach:af8/pi-atdd",
      PI_ATDD_EXECUTION_EXECUTION_ID: executionId, PI_ATDD_EXECUTION_SESSION_ID: sessionId,
      PI_ATDD_EXECUTION_MODEL_ID: "pi-claude-cli/claude-haiku-5-5", PI_ATDD_EXECUTION_GENERATION: "1",
      PI_ATDD_EXECUTION_OWNER_TOKEN: "unknown-to-test" } as NodeJS.ProcessEnv;
    assert.ok(readSeatLease(executionConfigFromEnv(env)!.leasePath), "launch bootstrapped the lease");
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

test("ATD-36 A07: the dry run prints a plan that never shows the owner token", () => {
  const w = world();
  try {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", "launch", "--dry-run",
      "--role", "worker", "--label", "Worker One", "--task", "ATD-40", "--profile", "af8", "--project", "pi-atdd",
      "--coach", "coach:af8/pi-atdd", "--agent-dir", w.root, "--model", "pi-claude-cli/claude-haiku-5-5"],
      { cwd: REPO, encoding: "utf8", env: process.env });
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
