// Acceptance: PLT-94 MI-001..MI-005 (mode by intent: set_atdd_mode tool, instruction, ATDD-repo guard).
// The model's reading of intent (any wording or language) is checked live; these tests pin
// the extension side: tool exposure, instruction, guard, announcement and log.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";
import { modeFromText } from "../src/mode.ts";

const TOOL = "set_atdd_mode";

function repo(markers: { plan?: boolean; yaml?: boolean; recorded?: string } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-intent-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git("init", "-q"); git("config", "user.name", "Pi tester"); git("config", "user.email", "test@example.invalid");
  mkdirSync(join(cwd, "src/orders/routes"), { recursive: true });
  writeFileSync(join(cwd, "src/orders/routes/create.ts"), "export const created = false;\n");
  if (markers.plan) { mkdirSync(join(cwd, "plan")); writeFileSync(join(cwd, "plan/README.md"), "plan\n"); }
  if (markers.yaml) writeFileSync(join(cwd, "atdd-pi.yaml"), "{}\n");
  if (markers.recorded) { mkdirSync(join(cwd, ".atdd-pi")); writeFileSync(join(cwd, ".atdd-pi/mode"), markers.recorded + "\n"); }
  git("add", "."); git("commit", "-qm", "base");
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

type Tool = { name: string; promptGuidelines?: string[]; defaultActive?: boolean;
  execute: (id: string, params: unknown, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => Promise<any> };

function session(cwd: string, opts: { mode?: string; confirm?: boolean; select?: string } = {}) {
  const handlers = new Map<string, Function>();
  const tools = new Map<string, Tool>();
  let activeTools = ["read", "bash", "edit", "write"];
  const notes: string[] = [], confirms: string[] = [], entries: Array<{ type: string; data: any }> = [];
  const p = {
    on: (name: string, fn: Function) => { handlers.set(name, fn); },
    registerCommand: () => {},
    registerTool: (t: Tool) => { tools.set(t.name, t); if (t.defaultActive !== false) activeTools.push(t.name); },
    getActiveTools: () => [...activeTools],
    setActiveTools: (names: string[]) => { activeTools = [...names]; },
    appendEntry: (type: string, data: any) => { entries.push({ type, data }); },
    sendMessage: () => {},
  };
  atdd(p as any);
  const mode = opts.mode ?? "tui";
  const ctx = {
    cwd, isProjectTrusted: () => true, mode, hasUI: mode === "tui" || mode === "rpc",
    sessionManager: { getBranch: () => [] },
    ui: {
      notify: (text: string) => { notes.push(text); },
      select: async (_title: string, options: string[]) => options.find(o => o.startsWith(opts.select ?? "ATDD — this session")),
      confirm: async (title: string, message: string) => { confirms.push(title + " " + message); return opts.confirm ?? false; },
    },
  };
  handlers.get("session_start")!({ reason: "startup" }, ctx);
  const start = async (prompt: string) => await handlers.get("before_agent_start")!({ messageType: "user", prompt }, ctx);
  const edit = async (path: string) => await handlers.get("tool_call")!({ toolName: "edit", input: { path } }, ctx);
  const call = async (params: { mode: string; reason: string }) => await tools.get(TOOL)!.execute("call-1", params, undefined, undefined, ctx);
  const text = (r: any) => r.content.map((c: { text: string }) => c.text).join("\n");
  return { tools, active: () => activeTools, notes, confirms, entries, start, edit, call, text };
}
async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const old = process.env.PI_ATDD_MODE;
  if (value === undefined) delete process.env.PI_ATDD_MODE; else process.env.PI_ATDD_MODE = value;
  try { return await fn(); }
  finally { if (old === undefined) delete process.env.PI_ATDD_MODE; else process.env.PI_ATDD_MODE = old; }
}

test("set_atdd_mode is registered inactive, with a one-line intent instruction", () => {
  const r = repo();
  try {
    const s = session(r.cwd, { mode: "print" });
    const tool = s.tools.get(TOOL);
    assert.ok(tool, "tool registered");
    assert.equal(tool!.defaultActive, false);
    assert.equal(tool!.promptGuidelines?.length, 1, "one instruction");
    const rule = tool!.promptGuidelines![0]!;
    assert.equal(rule.includes("\n"), false);
    assert.match(rule, /set_atdd_mode/);
    for (const word of [/exploratory/, /throwaway/, /scratchpad/, /spike/, /prototype/, /any wording or language/, /never switch to plain to avoid a convention/i])
      assert.match(rule, word);
  } finally { r.cleanup(); }
});

test("MI-001 non-ATDD repo: plain via the tool, no confirmation, announced in one line and logged", () => withEnv(undefined, async () => {
  const r = repo();
  try {
    const s = session(r.cwd);
    assert.ok(s.active().includes(TOOL), "active in an interactive session");
    await s.start("Implement authorization"); // answers the PLT-93 question: ATDD, this session only
    assert.equal((await s.edit("src/orders/routes/create.ts")).block, true, "ATDD guards edits before the switch");
    const before = s.notes.length;
    const result = await s.call({ mode: "plain", reason: "user said it is a quick scratchpad" });
    assert.notEqual(result.isError, true);
    assert.match(s.text(result), /plain/);
    assert.equal(s.confirms.length, 0, "no confirmation outside an ATDD repository");
    assert.equal(await s.edit("src/orders/routes/create.ts"), undefined, "plain: no edit guard");
    const announced = s.notes.slice(before);
    assert.equal(announced.length, 1, "announced once");
    assert.match(announced[0]!, /plain/);
    assert.match(announced[0]!, /scratchpad/);
    assert.equal(announced[0]!.includes("\n"), false);
    assert.deepEqual(s.entries.map(e => [e.type, e.data.mode, e.data.outcome]), [["pi-atdd-mode", "plain", "switched"]]);
  } finally { r.cleanup(); }
}));

test("MI-002 repo declaring ATDD: plain is refused without the user's confirmation", () => withEnv(undefined, async () => {
  for (const markers of [{ plan: true }, { yaml: true }, { recorded: "atdd" }]) {
    const r = repo(markers);
    try {
      const s = session(r.cwd, { confirm: false });
      await s.start("quick scratchpad to try an idea");
      const refused = await s.call({ mode: "plain", reason: "scratchpad" });
      assert.equal(refused.isError, true, JSON.stringify(markers));
      assert.match(s.text(refused), /declares ATDD/);
      assert.match(s.text(refused), /ask/i);
      assert.equal(s.confirms.length, 1, "the user is asked, not the model trusted");
      assert.equal((await s.edit("src/orders/routes/create.ts")).block, true, "still ATDD");
      assert.equal(s.notes.at(-1)!.includes("\n"), false);
      assert.match(s.notes.at(-1)!, /refused/);
      assert.equal(s.entries.at(-1)!.data.outcome, "refused");

      const yes = session(r.cwd, { confirm: true });
      await yes.start("quick scratchpad to try an idea");
      assert.notEqual((await yes.call({ mode: "plain", reason: "user confirmed a scratchpad" })).isError, true);
      assert.equal(yes.confirms.length, 1);
      assert.equal(await yes.edit("src/orders/routes/create.ts"), undefined, "plain after the user's yes");
      // Switching back to ATDD is always allowed, without a question.
      assert.notEqual((await yes.call({ mode: "atdd", reason: "real work now" })).isError, true);
      assert.equal(yes.confirms.length, 1);
      assert.equal((await yes.edit("src/orders/routes/create.ts")).block, true);
    } finally { r.cleanup(); }
  }
}));

test("MI-003/MI-004 keyword detector unchanged: intent phrases are left to the model", () => {
  assert.equal(modeFromText("fix the login bug"), undefined);
  assert.equal(modeFromText("quick scratchpad to try an idea"), undefined);
  assert.equal(modeFromText("un brouillon jetable pour tester une idée"), undefined);
  assert.equal(modeFromText("build me a quick app, plain"), "plain");
  assert.equal(modeFromText("use ATDD for the refactor"), "atdd");
});

test("MI-005 print/RPC/JSON: tool inactive, no instruction, refuses if called", () => withEnv("atdd", async () => {
  const r = repo();
  try {
    for (const mode of ["print", "rpc", "json"]) {
      const s = session(r.cwd, { mode, confirm: true });
      assert.equal(s.active().includes(TOOL), false, mode);
      await s.start("quick scratchpad to try an idea");
      const refused = await s.call({ mode: "plain", reason: "scratchpad" });
      assert.equal(refused.isError, true, mode);
      assert.match(s.text(refused), /non-interactive/);
      assert.equal(s.confirms.length, 0, mode);
      assert.equal((await s.edit("src/orders/routes/create.ts")).block, true, mode + ": mode from env only");
    }
  } finally { r.cleanup(); }
}));
