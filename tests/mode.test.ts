// URN: test:pi-atdd:deliver-guidance:plt-93-ap-001
// Acceptance: acc:pi-atdd:plt-93-ap-001
// Acceptance: acc:pi-atdd:plt-93-ap-002
// Acceptance: acc:pi-atdd:plt-93-ap-003
// Acceptance: acc:pi-atdd:plt-93-ap-004
// Acceptance: acc:pi-atdd:plt-93-ap-005
// Acceptance: acc:pi-atdd:plt-93-ap-006
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";
import { modeFromText, resolveMode } from "../src/mode.ts";

function repo(markers: { plan?: boolean; git?: boolean } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-mode-"));
  if (markers.git !== false) {
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
    git("init", "-q"); git("config", "user.name", "Pi tester"); git("config", "user.email", "test@example.invalid");
    mkdirSync(join(cwd, "src/orders/routes"), { recursive: true });
    writeFileSync(join(cwd, "src/orders/routes/create.ts"), "export const created = false;\n");
    if (markers.plan) { mkdirSync(join(cwd, "plan")); writeFileSync(join(cwd, "plan/README.md"), "plan\n"); }
    git("add", "."); git("commit", "-qm", "base");
  }
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
/** One extension instance = one Pi session. */
function session(cwd: string, opts: { interactive?: boolean; mode?: string; answer?: string } = {}) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { handler: Function }>();
  const questions: string[] = [], notes: string[] = [];
  const p = {
    on: (name: string, fn: Function) => { handlers.set(name, fn); },
    registerCommand: (name: string, c: { handler: Function }) => { commands.set(name, c); },
    registerTool: () => {},
    sendMessage: () => {},
  };
  atdd(p as any);
  const mode = opts.mode ?? (opts.interactive ? "tui" : "print");
  const ctx = {
    cwd, isProjectTrusted: () => true, mode, hasUI: mode === "tui" || mode === "rpc",
    sessionManager: { getBranch: () => [] },
    ui: {
      notify: (text: string) => { notes.push(text); },
      select: async (title: string, options: string[]) => {
        questions.push(title);
        return options.find(o => o.toLowerCase().startsWith(opts.answer ?? "plain"));
      },
    },
  };
  const start = async (prompt: string) => await handlers.get("before_agent_start")!({ messageType: "user", prompt }, ctx);
  const edit = async (path: string) => await handlers.get("tool_call")!({ toolName: "edit", input: { path } }, ctx);
  const command = async (args: string) => await commands.get("atdd")!.handler(args, ctx);
  return { handlers, ctx, questions, notes, start, edit, command };
}
async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const old = process.env.PI_ATDD_MODE;
  if (value === undefined) delete process.env.PI_ATDD_MODE; else process.env.PI_ATDD_MODE = value;
  try { return await fn(); }
  finally { if (old === undefined) delete process.env.PI_ATDD_MODE; else process.env.PI_ATDD_MODE = old; }
}

test("plain-language detection is conservative", () => {
  assert.equal(modeFromText("build me a quick app, plain"), "plain");
  assert.equal(modeFromText("plain, it's a quick app"), "plain");
  assert.equal(modeFromText("Do this without ATDD please"), "plain");
  assert.equal(modeFromText("no atdd for this one"), "plain");
  assert.equal(modeFromText("use ATDD for the refactor"), "atdd");
  assert.equal(modeFromText("write the README in plain text"), undefined);
  assert.equal(modeFromText("explain it in plain English"), undefined);
  assert.equal(modeFromText("the plain, boring option"), undefined);
  assert.equal(modeFromText("Implement authorization"), undefined);
});

test("AP-001 new repo, interactive: one question; plain is recorded; next session does not ask", () => withEnv(undefined, async () => {
  const r = repo();
  try {
    const s1 = session(r.cwd, { interactive: true, answer: "plain" });
    assert.equal(await s1.start("Implement authorization"), undefined, "plain injects nothing");
    assert.equal(s1.questions.length, 1);
    assert.match(s1.questions[0]!, /ATDD or plain/);
    assert.equal(readFileSync(join(r.cwd, ".atdd-pi/mode"), "utf8").trim(), "plain");
    await s1.start("Implement authorization again");
    assert.equal(s1.questions.length, 1, "asked once per session");
    const s2 = session(r.cwd, { interactive: true, answer: "atdd" });
    assert.equal(await s2.start("Implement authorization"), undefined);
    assert.equal(s2.questions.length, 0, "recorded choice is reused");
    assert.equal(await s2.edit("src/orders/routes/create.ts"), undefined);
  } finally { r.cleanup(); }
}));

test("AP-002 'build me a quick app, plain' → no question, plain, no injection, no edit blocks", () => withEnv(undefined, async () => {
  const r = repo();
  try {
    const s = session(r.cwd, { interactive: true, answer: "atdd" });
    assert.equal(await s.start("build me a quick app, plain"), undefined);
    assert.equal(s.questions.length, 0);
    assert.equal(await s.edit("src/orders/routes/create.ts"), undefined);
    const bash = await s.handlers.get("tool_call")!({ toolName: "bash", input: { command: "echo x > src/orders/routes/create.ts" } }, s.ctx);
    assert.equal(bash, undefined);
    assert.ok(s.notes.some(n => /plain/i.test(n) && !n.includes("\n")), "mode change announced in one line");
    assert.equal(existsSync(join(r.cwd, ".atdd-pi/mode")), false, "a one-off message does not rewrite the repo record");
  } finally { r.cleanup(); }
}));

test("AP-003 repo with ATDD markers starts in ATDD without a question", () => withEnv(undefined, async () => {
  const r = repo({ plan: true });
  try {
    const s = session(r.cwd, { interactive: true, answer: "plain" });
    const injected = await s.start("Implement authorization");
    assert.equal(s.questions.length, 0);
    assert.match(injected.message.content, /coder\.security\.missing-auth/);
    assert.equal((await s.edit("src/orders/routes/create.ts")).block, true);
  } finally { r.cleanup(); }
}));

test("AP-004 print/RPC never ask; PI_ATDD_MODE=plain|atdd is honoured", async () => {
  const r = repo();
  try {
    for (const mode of ["print", "rpc", "json"]) {
      await withEnv("plain", async () => {
        const s = session(r.cwd, { mode });
        assert.equal(await s.start("Implement authorization"), undefined, mode);
        assert.equal(s.questions.length, 0, mode);
        assert.equal(await s.edit("src/orders/routes/create.ts"), undefined, mode);
      });
      await withEnv("atdd", async () => {
        const s = session(r.cwd, { mode });
        assert.match((await s.start("Implement authorization")).message.content, /coder\.security\.missing-auth/);
        assert.equal(s.questions.length, 0, mode);
      });
      await withEnv(undefined, async () => {
        const s = session(r.cwd, { mode });
        const settled = await Promise.race([s.start("Implement authorization").then(() => true),
          new Promise(res => setTimeout(() => res(false), 1000))]);
        assert.equal(settled, true, "never waits for an answer");
        assert.equal(s.questions.length, 0, mode);
      });
    }
    assert.deepEqual(resolveMode({ cwd: r.cwd, env: { PI_ATDD_MODE: "plain" } }), { mode: "plain", source: "PI_ATDD_MODE" });
  } finally { r.cleanup(); }
});

test("AP-005 /atdd off then /atdd on toggles within a session; status is one line", () => withEnv("atdd", async () => {
  const r = repo();
  try {
    const s = session(r.cwd, { mode: "print" });
    assert.match((await s.start("Implement authorization")).message.content, /missing-auth/);
    await s.command("off");
    assert.equal(await s.edit("src/orders/routes/create.ts"), undefined);
    await s.command("status");
    assert.match(s.notes.at(-1)!, /plain/);
    assert.equal(s.notes.at(-1)!.includes("\n"), false);
    await s.command("on");
    assert.equal((await s.edit("src/orders/routes/create.ts")).block, true);
    await s.command("status");
    assert.match(s.notes.at(-1)!, /mode: atdd/);
    assert.equal(s.notes.at(-1)!.includes("\n"), false);
  } finally { r.cleanup(); }
}));

test("AP-006 edits outside a repository are not refused in either mode", async () => {
  const inside = repo({ plan: true });
  const outside = repo({ git: false });
  try {
    for (const env of ["atdd", "plain"]) await withEnv(env, async () => {
      const s = session(inside.cwd, { mode: "print" });
      await s.start("Implement authorization");
      assert.equal(await s.edit(join(outside.cwd, "notes.md")), undefined, env);
      if (env === "atdd") {
        // An outside path that is physically inside the repository stays governed.
        const back = join(outside.cwd, "back-" + env);
        symlinkSync(join(inside.cwd, "src"), back, "dir");
        assert.equal((await s.edit(join(back, "orders/routes/create.ts"))).block, true);
      }
      const loose = session(outside.cwd, { interactive: true });
      assert.equal(await loose.start("Implement authorization"), undefined, "no injection outside a repo");
      assert.equal(loose.questions.length, 0);
      assert.equal(await loose.edit("notes.md"), undefined, env);
    });
  } finally { inside.cleanup(); outside.cleanup(); }
});
