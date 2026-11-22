// URN: test:pi-atdd:seat-bootstrap:ATD-36
// Acceptance: acc:pi-atdd:ATD-36-A01
// Acceptance: acc:pi-atdd:ATD-36-A02
// Acceptance: acc:pi-atdd:ATD-36-A03
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { attentionSeatOptions } from "../src/attention-seat.ts";
import { executionConfigFromEnv, missingExecutionVariables } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";
import { bootstrapSeatFromEnv } from "../src/seat-bootstrap.ts";

const REQUIRED = ["MODE", "PROJECT_ID", "TASK_ID", "COACH_ADDRESS", "SEAT_ADDRESS", "EXECUTION_ID",
  "SESSION_ID", "MODEL_ID", "GENERATION", "OWNER_TOKEN"].map(k => "PI_ATDD_EXECUTION_" + k);
const REPO = new URL("..", import.meta.url).pathname;

const world = () => {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-atd36-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};
// What the launcher exports for a coach today: attention scope only, no execution seat.
const attentionEnv = (root: string): NodeJS.ProcessEnv => ({
  PI_CODING_AGENT_DIR: root, PI_ATDD_MODE: "atdd",
  PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "Coach A", PI_ATDD_ATTENTION_PROFILE: "af8",
  PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd", PI_ATDD_ATTENTION_COACH_ADDRESS: "coach:af8/pi-atdd",
});
// The seat the launcher would add once it bootstraps the coach's standalone seat.
const seatEnv = (root: string, session = "sess-coach-1"): NodeJS.ProcessEnv => ({
  ...attentionEnv(root), PI_ATDD_EXECUTION_MODE: "standalone", PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd",
  PI_ATDD_EXECUTION_TASK_ID: "*", PI_ATDD_EXECUTION_COACH_ADDRESS: "coach:af8/pi-atdd",
  PI_ATDD_EXECUTION_SEAT_ADDRESS: "coach:af8/pi-atdd", PI_ATDD_EXECUTION_EXECUTION_ID: "coach-run-1",
  PI_ATDD_EXECUTION_SESSION_ID: session, PI_ATDD_EXECUTION_MODEL_ID: "pi-claude-cli/model",
  PI_ATDD_EXECUTION_GENERATION: "1", PI_ATDD_EXECUTION_OWNER_TOKEN: "owner-token-1",
});
const ctxFor = (session: string, notes: string[] = []) => ({
  cwd: "/tmp", isProjectTrusted: () => true, model: { provider: "p", id: "m" },
  sessionManager: { getSessionId: () => session, getBranch: () => [] },
  ui: { notify: (m: string) => { notes.push(m); }, setWidget: () => {} },
});
const toolsFor = (env: NodeJS.ProcessEnv) => {
  const tools = new Map<string, any>();
  const seat = env.PI_ATDD_EXECUTION_MODE
    ? registerSeatExecution({ on: () => {}, registerCommand: () => {} } as any, env) : undefined;
  registerAttentionStrip({ on: () => {}, registerTool: (d: any) => tools.set(d.name, d),
    registerCommand: () => {}, appendEntry: () => {} } as any, {
    env, now: () => new Date("2026-11-22T10:00:00Z"), ...attentionSeatOptions(seat),
  });
  return tools;
};

test("ATD-36 A01: a refusal with attention variables and no execution seat names every missing PI_ATDD_EXECUTION_* variable", async () => {
  const w = world();
  try {
    const env = attentionEnv(w.root);
    assert.deepEqual(missingExecutionVariables(env), REQUIRED);
    await assert.rejects(toolsFor(env).get("attention_list").execute("call", {}, undefined, undefined, ctxFor("s")),
      (err: Error) => {
        assert.match(err.message, /not authorized/);
        for (const name of REQUIRED) assert.match(err.message, new RegExp(name));
        return true;
      });
  } finally { w.cleanup(); }
});

test("ATD-36 A01: startup with attention scope but no seat says what is missing, and the check stays fail-closed", () => {
  const w = world();
  try {
    const handlers = new Map<string, (e: unknown, ctx: any) => unknown>();
    const pi = { on: (name: string, cb: any) => handlers.set(name, cb), registerCommand: () => {} };
    assert.equal(registerSeatExecution(pi as any, attentionEnv(w.root)), undefined);
    const notes: string[] = [];
    handlers.get("session_start")!({}, ctxFor("sess-coach-1", notes));
    assert.equal(notes.length, 1);
    for (const name of REQUIRED) assert.match(notes[0]!, new RegExp(name));
  } finally { w.cleanup(); }
});

test("ATD-36 A01: a partial execution binding is refused and the message names only the missing variables", () => {
  const w = world();
  try {
    const partial = { ...attentionEnv(w.root), PI_ATDD_EXECUTION_MODE: "standalone", PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd" };
    assert.throws(() => executionConfigFromEnv(partial), (err: Error) => {
      assert.match(err.message, /PI_ATDD_EXECUTION_TASK_ID/);
      assert.doesNotMatch(err.message, /PI_ATDD_EXECUTION_PROJECT_ID/);
      return true;
    });
  } finally { w.cleanup(); }
});

test("ATD-36 A02: a session started with a launcher-bootstrapped seat is authorized for attention_list", async () => {
  const w = world();
  try {
    const env = seatEnv(w.root);
    assert.deepEqual(missingExecutionVariables(env), []);
    const bound = bootstrapSeatFromEnv(env);
    assert.equal(bound.generation, 1);
    assert.equal(bound.sessionId, "sess-coach-1");
    const result = await toolsFor(env).get("attention_list").execute("call", {}, undefined, undefined, ctxFor("sess-coach-1"));
    assert.ok(Array.isArray(result.details.items));
  } finally { w.cleanup(); }
});

test("ATD-36 A02: the bootstrap command is launcher-callable, idempotent for the same binding, and never prints the owner token", () => {
  const w = world();
  try {
    const env = { ...process.env, ...seatEnv(w.root) };
    const run = (e: NodeJS.ProcessEnv) => spawnSync(process.execPath,
      ["--experimental-strip-types", "src/cli.ts", "seat", "bootstrap"], { cwd: REPO, env: e, encoding: "utf8" });
    const first = run(env);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.doesNotMatch(first.stdout, /owner-token-1/);
    assert.equal(JSON.parse(first.stdout).sessionId, "sess-coach-1");
    assert.equal(run(env).status, 0);
    const other = run({ ...env, PI_ATDD_EXECUTION_SESSION_ID: "sess-other" });
    assert.notEqual(other.status, 0);
    assert.match(other.stdout, /seat already assigned/);
  } finally { w.cleanup(); }
});

test("ATD-36 A02: a second launch with a different execution id cannot adopt an existing seat lease", () => {
  const w = world();
  try {
    bootstrapSeatFromEnv(seatEnv(w.root));
    assert.throws(() => bootstrapSeatFromEnv({ ...seatEnv(w.root), PI_ATDD_EXECUTION_EXECUTION_ID: "coach-run-2" }),
      /seat already assigned/);
  } finally { w.cleanup(); }
});

test("ATD-36 A02: the launcher proposal uses a fresh random UUID per launch, never a timestamp, and reads the session id from the file on relaunch", () => {
  const doc = readFileSync(join(REPO, "docs", "ATD-36-SEAT-BOOTSTRAP.md"), "utf8");
  assert.doesNotMatch(doc, /date -u/, "no timestamp-based ids in the launcher proposal");
  for (const line of doc.split("\n").filter(l => /EXECUTION_ID/.test(l)))
    assert.match(line, /UUID|RUN_ID/, line);
  assert.match(doc, /fresh random UUID per launch/);
  assert.match(doc, /--session-id/);
  assert.match(doc, /read from the session file header/);
});

test("ATD-36 A03: a seat bound to another session still refuses, without claiming that variables are missing", async () => {
  const w = world();
  try {
    bootstrapSeatFromEnv(seatEnv(w.root, "sess-coach-1"));
    const tools = toolsFor(seatEnv(w.root, "sess-coach-1"));
    await assert.rejects(tools.get("attention_list").execute("call", {}, undefined, undefined, ctxFor("sess-foreign")),
      (err: Error) => {
        assert.match(err.message, /not authorized/);
        assert.doesNotMatch(err.message, /PI_ATDD_EXECUTION_/);
        return true;
      });
  } finally { w.cleanup(); }
});
