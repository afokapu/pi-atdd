// URN: test:pi-atdd:hand-off-context:plt-102-a03
// Acceptance: acc:pi-atdd:plt-102-a03
// PLT-102 review P1: the handoff record must not carry secrets or the predecessor's own output.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildHandoff, redact } from "../src/context-handoff.ts";
import atdd from "../extensions/atdd.ts";

test("redact replaces secret-shaped values and keeps ordinary words, slugs and paths", () => {
  assert.equal(redact("use password=TOPSECRET now"), "use password=[REDACTED] now");
  assert.equal(redact("api_key: abc123xyz"), "api_key: [REDACTED]");
  assert.equal(redact("header Bearer eyJhbGciOi.payload-part"), "header Bearer [REDACTED]");
  assert.equal(redact("token sk-live_0123456789abcdef"), "token [REDACTED]");
  assert.equal(redact("ghp_0123456789abcdefghij"), "[REDACTED]");
  assert.equal(redact("digest 0123456789abcdef0123456789abcdef01234567"), "digest [REDACTED]");
  const ordinary = "plt-102 feature/plt-102-add-automatic-context-handoff-at-85-usage /Users/alecfokapu/github/worktrees/pi-atdd/plt-102/src/context-handoff.ts";
  assert.equal(redact(ordinary), ordinary);
});

test("the seeded password, a bearer token and a long token never reach the record", () => {
  const text = buildHandoff({
    task: "PLT-102 deploy with password=TOPSECRET and Bearer abc.def-123 and token: ZZTOP123456789012345678901234567890 done",
    cwd: "/w", percent: 86, contextWindow: 1000,
  });
  assert.doesNotMatch(text, /TOPSECRET/);
  assert.doesNotMatch(text, /abc\.def-123/);
  assert.doesNotMatch(text, /ZZTOP/);
  assert.match(text, /password=\[REDACTED\]/);
});

test("the record does not copy the predecessor's own output", () => {
  const text = buildHandoff({ task: "PLT-102 x", cwd: "/w", percent: 86, contextWindow: 1000 });
  assert.match(text, /Done \/ last state: not recorded/);
});

test("Pi adapter: the written record redacts the prompt and omits the predecessor's output", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-safety-"));
  try {
    const handlers = new Map<string, Function>();
    const sent: string[] = [];
    atdd({
      on: (name: string, fn: Function) => { handlers.set(name, fn); },
      registerCommand: () => {}, registerTool: () => {}, sendMessage: () => {},
      getActiveTools: () => [], setActiveTools: () => {},
      sendUserMessage: (text: string) => { sent.push(text); },
    } as any);
    const ctx = {
      cwd, isProjectTrusted: () => true, ui: { notify: () => {} },
      getContextUsage: () => ({ tokens: 172000, contextWindow: 200000, percent: 86 }),
      sessionManager: { getSessionFile: () => "/parent.jsonl", getBranch: () => [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "PLT-102 deploy password=TOPSECRET" }] } },
      ] },
    };
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("turn_end")!({ message: { content: [{ type: "text", text: "SECRET-ASSISTANT-OUTPUT: finished" }] } }, ctx);
    await handlers.get("agent_settled")!({ aborted: false }, ctx);
    assert.deepEqual(sent, ["/atdd-handoff"]);
    const dir = join(cwd, ".atdd-pi", "handoffs");
    const [file] = readdirSync(dir);
    const body = readFileSync(join(dir, file!), "utf8");
    assert.doesNotMatch(body, /TOPSECRET/);
    assert.match(body, /password=\[REDACTED\]/);
    assert.doesNotMatch(body, /SECRET-ASSISTANT-OUTPUT/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
