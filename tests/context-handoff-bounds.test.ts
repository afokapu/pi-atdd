// PLT-102 review fixes: bounded handoff chains and handoff before Pi's own compaction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHandoff, clampToCompaction, decideContextAction, INITIAL_HANDOFF_STATE, parseHop, resolveMaxHops,
} from "../src/context-handoff.ts";
import atdd from "../extensions/atdd.ts";

const T = { notifyAt: 80, handoffAt: 85 };

test("hop limit defaults to 5 and rejects invalid values", () => {
  assert.equal(resolveMaxHops({}), 5);
  assert.equal(resolveMaxHops({ PI_ATDD_HANDOFF_MAX_HOPS: "3" }), 3);
  assert.throws(() => resolveMaxHops({ PI_ATDD_HANDOFF_MAX_HOPS: "0" }), /integer 1-50/);
  assert.throws(() => resolveMaxHops({ PI_ATDD_HANDOFF_MAX_HOPS: "many" }), /integer 1-50/);
});

test("compaction clamp: a large window keeps the thresholds; a small window hands off before compaction", () => {
  // 200k window, 16,384 reserve: compaction starts at ~91.8%, so 85% still fires first.
  assert.deepEqual(clampToCompaction(T, 200000, 16384), T);
  // 20k window, same reserve: compaction starts at ~18.1%, so the handoff must come below that.
  const small = clampToCompaction(T, 20000, 16384);
  assert.ok(small.handoffAt <= 18.1 && small.handoffAt > 0, "handoff capped below the compaction line");
  assert.ok(small.notifyAt <= small.handoffAt, "notify never above handoff");
});

test("at the hop limit, crossing the handoff threshold is a 'limit' once, not a new handoff", () => {
  const first = decideContextAction(90, T, INITIAL_HANDOFF_STATE, true);
  assert.equal(first.action, "limit");
  assert.equal(decideContextAction(95, T, first.state, true).action, "none");
  // Below the limit the same crossing is still a normal handoff.
  assert.equal(decideContextAction(90, T, INITIAL_HANDOFF_STATE, false).action, "handoff");
});

test("the record carries its hop, and a successor reads it back; plain text is hop 0", () => {
  const text = buildHandoff({ task: "PLT-102 x", cwd: "/w", percent: 86, contextWindow: 1000, hop: 3 });
  assert.match(text, /^Hop: 3/m);
  assert.equal(parseHop(text), 3);
  assert.equal(parseHop("an ordinary user message that says Hop: 9"), 0, "text without the record header is not a hop");
});

test("adapter: a successor at the hop limit does not hand off again, so chains are bounded", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-chain-"));
  try {
    const run = async (hop: number) => {
      const handlers = new Map<string, Function>();
      const sent: string[] = [];
      const notes: string[] = [];
      atdd({
        on: (name: string, fn: Function) => { handlers.set(name, fn); },
        registerCommand: () => {}, registerTool: () => {}, sendMessage: () => {},
        getActiveTools: () => [], setActiveTools: () => {},
        sendUserMessage: (text: string) => { sent.push(text); },
      } as any);
      const record = buildHandoff({ task: "PLT-102 chain", cwd, percent: 86, contextWindow: 200000, hop });
      const user = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
      const ctx = {
        cwd, isProjectTrusted: () => true, ui: { notify: (m: string) => { notes.push(m); } },
        getContextUsage: () => ({ tokens: 172000, contextWindow: 200000, percent: 86 }),
        sessionManager: { getSessionFile: () => "/parent.jsonl",
          getBranch: () => [user(record), user("Continue PLT-102 from the ATDD context handoff above.")] },
      };
      await handlers.get("session_start")!({}, ctx);
      await handlers.get("turn_end")!({ message: { content: [{ type: "text", text: "working" }] } }, ctx);
      await handlers.get("agent_settled")!({ aborted: false }, ctx);
      return { sent, notes };
    };
    const below = await run(4);
    assert.deepEqual(below.sent, ["/atdd-handoff"], "hop 4 of 5 may still hand off");
    const atLimit = await run(5);
    assert.deepEqual(atLimit.sent, [], "hop 5 of 5 must not hand off again");
    assert.match(atLimit.notes.join("\n"), /chain limit \(5 hops\)/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
