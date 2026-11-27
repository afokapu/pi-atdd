// URN: test:pi-atdd:attention-seat-replacement:PLT-118
// Acceptance: acc:pi-atdd:plt-118-a05
// Acceptance: acc:pi-atdd:plt-118-a06
// PLT-118 PR #31 second return: real Pi session replacement (AgentSessionRuntime + ctx.newSession) rebuilds the
// extension runtime. The successor's NEW runtime must own the rotated seat and deliver a pending resolution.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, SessionManager,
  type CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { attentionSeatOptions } from "../src/attention-seat.ts";
import { bootstrapSeat, executionConfigFromEnv } from "../src/execution-seat.ts";
import { registerSeatExecution } from "../src/execution-pi.ts";

type Rt = { seat: ReturnType<typeof registerSeatExecution>; on: Map<string, Function[]>; tools: Map<string, any> };

test("PLT-118 fix2 P1 A05: after real Pi newSession the successor's new runtime owns the rotated seat and delivers the resolution", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-atdd-replace-"));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "proof.txt"), "one\n");
  execFileSync("git", ["-C", repo, "add", "proof.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "i"]);
  const saved = { ...process.env };
  Object.assign(process.env, {
    PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1",
    PI_ATDD_EXECUTION_MODE: "standalone", PI_ATDD_EXECUTION_PROJECT_ID: "pi-atdd", PI_ATDD_EXECUTION_TASK_ID: "PLT-118",
    PI_ATDD_EXECUTION_COACH_ADDRESS: "main@pi-atdd", PI_ATDD_EXECUTION_SEAT_ADDRESS: "driver@pi-atdd",
    PI_ATDD_EXECUTION_EXECUTION_ID: "run-a", PI_ATDD_EXECUTION_SESSION_ID: "session-a",
    PI_ATDD_EXECUTION_MODEL_ID: "provider/model", PI_ATDD_EXECUTION_GENERATION: "1", PI_ATDD_EXECUTION_OWNER_TOKEN: "token-a",
    PI_ATDD_ATTENTION_ROLE: "worker", PI_ATDD_ATTENTION_IDENTITY: "worker-1", PI_ATDD_ATTENTION_PROFILE: "forge",
    PI_ATDD_ATTENTION_PROJECT_ID: "pi-atdd", PI_ATDD_ATTENTION_COACH_ADDRESS: "main@pi-atdd",
    PI_ATDD_ATTENTION_TASK_ID: "PLT-118", PI_ATDD_ATTENTION_EXECUTION_ID: "run-a",
  });
  bootstrapSeat(executionConfigFromEnv(process.env)!);
  const runtimes: Rt[] = [];
  const result: Record<string, any> = {};
  // Mirrors the shipped wiring in pi-activation (seat, then attention strip) and the /atdd-handoff command shape.
  const extension = (pi: any) => {
    const rt: Rt = { seat: undefined, on: new Map(), tools: new Map() };
    const spy = new Proxy(pi, { get: (t, k) => k === "on" ? (n: string, f: Function) => { rt.on.set(n, [...rt.on.get(n) ?? [], f]); return t.on(n, f); }
      : k === "registerTool" ? (d: any) => { rt.tools.set(d.name, d); return t.registerTool(d); }
      : typeof t[k] === "function" ? t[k].bind(t) : t[k] });
    rt.seat = registerSeatExecution(spy);
    registerAttentionStrip(spy, attentionSeatOptions(rt.seat));
    runtimes.push(rt);
    pi.registerCommand("test-replace", { description: "test", handler: async (_a: string, ctx: any) => {
      const cp = rt.seat!.checkpoint(ctx, rt.seat!.snapshotAttention());
      const first = (await rt.tools.get("attention_raise").execute("c", { type: "decision", summary: "needs owner" }, undefined, undefined, ctx)).details.item;
      result.itemId = first.id;
      // The Coach answers while the worker is between sessions.
      const coachEnv: NodeJS.ProcessEnv = { ...process.env, PI_ATDD_ATTENTION_ROLE: "coach", PI_ATDD_ATTENTION_IDENTITY: "coach-1" };
      delete coachEnv.PI_ATDD_ATTENTION_TASK_ID; delete coachEnv.PI_ATDD_ATTENTION_EXECUTION_ID;
      const ctools = new Map<string, any>();
      registerAttentionStrip({ on: () => {}, registerTool: (d: any) => ctools.set(d.name, d), registerCommand: () => {}, appendEntry: () => {} } as any,
        { env: coachEnv, authorize: () => true });
      await ctools.get("attention_resolve").execute("c", { id: first.id, scope: "within_grant", note: "approved" }, undefined, undefined,
        { isProjectTrusted: () => true, sessionManager: { getBranch: () => [] }, ui: { setWidget: () => {}, notify: () => {} } });
      result.ns = await ctx.newSession({ withSession: async (next: any) => {
        try {
        rt.seat!.activateSuccessor(next, cp);
        const fresh = runtimes.at(-1)!;
        result.runtimeCount = runtimes.length;
        result.freshIsNewRuntime = fresh !== rt;
        result.owns = fresh.seat!.owns(next);
        result.generation = fresh.seat!.current().binding.generation;
        const turn: any[] = [];
        for (const f of fresh.on.get("before_agent_start") ?? []) { const r = await f({}, next); if (r) turn.push(r); }
        result.delivered = turn.some(r => String(r.message?.content).includes(first.id));
        try { result.raised = (await fresh.tools.get("attention_raise").execute("c", { type: "review", summary: "after" }, undefined, undefined, next)).details.item.route.sourceExecutionId; }
        catch (e) { result.raiseError = String(e); }
        result.rotated = fresh.seat!.current().binding.executionId;
        } catch (e) { result.withSessionError = String((e as Error).stack); }
      } });
    } });
  };
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR,
      resourceLoaderOptions: { extensionFactories: [extension], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true } });
    return { ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })), services, diagnostics: services.diagnostics };
  };
  try {
    const runtime = await createAgentSessionRuntime(factory, { cwd: repo, agentDir: process.env.PI_CODING_AGENT_DIR!,
      sessionManager: SessionManager.inMemory(repo, { id: "session-a" }) });
    // Same binding Pi's RPC mode installs: command ctx.newSession replaces the runtime, then rebinds.
    const bind = async () => runtime.session.bindExtensions({ mode: "rpc", commandContextActions: {
      waitForIdle: () => runtime.session.waitForIdle(),
      newSession: async (options: any) => runtime.newSession(options),
      fork: async () => ({ cancelled: true }), navigateTree: async () => ({ cancelled: true }),
      switchSession: async () => ({ cancelled: true }), reload: async () => {} } });
    runtime.setRebindSession(bind);
    await bind();
    await runtime.session.prompt("/test-replace");
    assert.equal(result.runtimeCount, 2, "Pi rebuilt the extension runtime: " + JSON.stringify(result));
    assert.equal(result.freshIsNewRuntime, true);
    assert.equal(result.generation, 2, "the new runtime sees the rotated generation");
    assert.equal(result.owns, true, "the new runtime owns the seat");
    assert.equal(result.delivered, true, "the pending resolution reaches the successor");
    assert.equal(result.raised, result.rotated, "the successor raises with the rotated execution");
    await runtime.dispose();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    rmSync(root, { recursive: true, force: true });
  }
});
