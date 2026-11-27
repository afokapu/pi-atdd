// URN: test:pi-atdd:hand-off-context:plt-102-a04
// Acceptance: acc:pi-atdd:plt-102-a04
// Acceptance: acc:pi-atdd:plt-102-a03
// PLT-102 independent re-review (RETURN at 8c02bb28): per-model compaction reserve, wider redaction labels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact, resolveCompactionReserve } from "../src/context-handoff.ts";
import atdd from "../extensions/atdd.ts";

const SMALL = { provider: "plt102-faux", id: "small" };

test("compaction reserve: the active model's override wins, then the global setting, then the default", () => {
  const settings = { compaction: { reserveTokens: 100, modelOverrides: { "plt102-faux/small": { reserveTokens: 400 } } } };
  assert.equal(resolveCompactionReserve(settings, SMALL), 400);
  assert.equal(resolveCompactionReserve(settings, { provider: "other", id: "x" }), 100);
  assert.equal(resolveCompactionReserve(settings, undefined), 100);
  assert.equal(resolveCompactionReserve({}, undefined), 16_384);
});

test("compaction reserve: an override without reserveTokens falls back per field, as Pi does", () => {
  const settings = { compaction: { reserveTokens: 100, modelOverrides: { "plt102-faux/small": { keepRecentTokens: 5 } } } };
  assert.equal(resolveCompactionReserve(settings, SMALL), 100);
});

test("compaction reserve: invalid values fall back to the default instead of a nonsense threshold", () => {
  assert.equal(resolveCompactionReserve({ compaction: { reserveTokens: "abc" } }, undefined), 16_384);
  assert.equal(resolveCompactionReserve({ compaction: { modelOverrides: { "plt102-faux/small": { reserveTokens: -1 } }, reserveTokens: 100 } }, SMALL), 100);
});

test("adapter: a per-model reserve moves the handoff line; the global reserve alone would not fire", async () => {
  const run = async (settings: unknown, percent: number) => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-reserve-"));
    try {
      const handlers = new Map<string, Function>();
      const sent: string[] = [];
      atdd({
        on: (name: string, fn: Function) => { handlers.set(name, fn); },
        registerCommand: () => {}, registerTool: () => {}, sendMessage: () => {},
        getActiveTools: () => [], setActiveTools: () => {},
        getSettings: () => settings,
        sendUserMessage: (text: string) => { sent.push(text); },
      } as any);
      const ctx = {
        cwd, isProjectTrusted: () => true, ui: { notify: () => {} }, model: SMALL,
        getContextUsage: () => ({ tokens: percent * 10, contextWindow: 1000, percent }),
        sessionManager: { getSessionFile: () => "/parent.jsonl", getBranch: () => [] },
      };
      await handlers.get("session_start")!({}, ctx);
      await handlers.get("turn_end")!({ message: { content: [{ type: "text", text: "working" }] } }, ctx);
      await handlers.get("agent_settled")!({ aborted: false }, ctx);
      const dir = join(cwd, ".atdd-pi", "handoffs");
      const files = (() => { try { return readdirSync(dir); } catch { return []; } })();
      return { sent, files: files.length, body: files[0] ? readFileSync(join(dir, files[0]), "utf8") : "" };
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };
  const withOverride = { compaction: { reserveTokens: 100, modelOverrides: { "plt102-faux/small": { reserveTokens: 400 } } } };
  const globalOnly = { compaction: { reserveTokens: 100 } };
  // Pi compacts at 60% with the override and at 90% with the global value (1k window).
  assert.equal((await run(withOverride, 30)).files, 0, "below the compaction line: nothing");
  const fired = await run(withOverride, 65);
  assert.deepEqual(fired.sent, ["/atdd-handoff"], "65% is above the 60% line implied by the override");
  assert.equal(fired.files, 1);
  const missed = await run(globalOnly, 65);
  assert.equal(missed.files, 0, "the global reserve alone would never have handed off at 65%");
});

test("redaction covers credential, auth, passphrase, secret, token, apikey, api_key and private key labels", () => {
  assert.equal(redact("credential=C1x"), "credential=[REDACTED]");
  assert.equal(redact("auth=hunter2"), "auth=[REDACTED]");
  assert.equal(redact("passphrase=correcthorse"), "passphrase=[REDACTED]");
  assert.equal(redact("secret: s3cr3t"), "secret: [REDACTED]");
  assert.equal(redact("token=t0k3n"), "token=[REDACTED]");
  assert.equal(redact("apikey=ak1"), "apikey=[REDACTED]");
  assert.equal(redact("api_key=ak2"), "api_key=[REDACTED]");
  assert.equal(redact("private key: pk1"), "private key: [REDACTED]");
  assert.equal(redact("private_key=pk2"), "private_key=[REDACTED]");
  assert.equal(redact("authorization=opaque"), "authorization=[REDACTED]");
  assert.equal(redact("Authorization Basic dXNlcjpwYXNz"), "Authorization Basic [REDACTED]");
});

test("redaction keeps ordinary words that only contain a label", () => {
  assert.equal(redact("the author: Alec and oauth discussion"), "the author: Alec and oauth discussion");
  assert.equal(redact("credentials review pending"), "credentials review pending");
});

test("adapter: a seeded credential=, auth= and passphrase= never reach the record", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-labels-"));
  try {
    const handlers = new Map<string, Function>();
    const sent: string[] = [];
    atdd({
      on: (name: string, fn: Function) => { handlers.set(name, fn); },
      registerCommand: () => {}, registerTool: () => {}, sendMessage: () => {},
      getActiveTools: () => [], setActiveTools: () => {}, getSettings: () => ({}),
      sendUserMessage: (text: string) => { sent.push(text); },
    } as any);
    const ctx = {
      cwd, isProjectTrusted: () => true, ui: { notify: () => {} },
      getContextUsage: () => ({ tokens: 172000, contextWindow: 200000, percent: 86 }),
      sessionManager: { getSessionFile: () => "/parent.jsonl", getBranch: () => [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "PLT-102 run credential=CRED-LEAK auth=AUTH-LEAK passphrase=PASS-LEAK" }] } },
      ] },
    };
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("turn_end")!({ message: { content: [{ type: "text", text: "ok" }] } }, ctx);
    await handlers.get("agent_settled")!({ aborted: false }, ctx);
    assert.deepEqual(sent, ["/atdd-handoff"]);
    const dir = join(cwd, ".atdd-pi", "handoffs");
    const [file] = readdirSync(dir);
    const body = readFileSync(join(dir, file!), "utf8");
    assert.doesNotMatch(body, /CRED-LEAK|AUTH-LEAK|PASS-LEAK/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
