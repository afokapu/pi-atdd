// URN: test:pi-atdd:attention-lock:ATD-47-smoke
// Acceptance: acc:pi-atdd:atd-47-a04
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { withAttentionLock } from "../src/attention.ts";
import { registerAttentionStrip } from "../src/attention-strip.ts";

const [mode, root = ""] = process.argv.slice(2);
if (mode === "hold") {
  withAttentionLock(join(root, "attention", "spool.jsonl"), () => {
    process.stdout.write("held\n");
    readSync(0, Buffer.alloc(1), 0, 1, null);
  });
} else {
  const dir = mkdtempSync(join(tmpdir(), "atd47-smoke-"));
  const handlers = new Map<string, Function>();
  const notes: string[] = [], entries: unknown[] = [];
  let tick = () => {};
  const ctx = { isProjectTrusted: () => true, sessionManager: { getBranch: () => entries },
    ui: { notify: (message: string) => notes.push(message), setWidget: () => {} } };
  const pi = { on: (name: string, fn: Function) => handlers.set(name, fn), registerTool: () => {},
    registerCommand: () => {}, appendEntry: (customType: string, data: unknown) => entries.push({type: "custom", customType, data}) };
  registerAttentionStrip(pi as any, { env: {PI_CODING_AGENT_DIR: dir, PI_ATDD_ATTENTION_ROLE: "coach",
    PI_ATDD_ATTENTION_PROFILE: "test", PI_ATDD_ATTENTION_IDENTITY: "coach", PI_ATDD_ATTENTION_PROJECT_ID: "p",
    PI_ATDD_ATTENTION_COACH_ADDRESS: "coach@p"}, authorize: () => true,
    setInterval: fn => { tick = fn; return fn; }, clearInterval: () => {} });
  const hold = async () => {
    const child = spawn(process.execPath, ["--experimental-strip-types", import.meta.filename, "hold", dir], {stdio: ["pipe", "pipe", "inherit"]});
    const exited = once(child, "exit");
    await once(child.stdout, "data");
    return {child, exited};
  };
  try {
    const brief = await hold();
    try {
      handlers.get("session_start")!({}, ctx); tick();
      assert.deepEqual(notes, []);
    } finally { brief.child.stdin.end("x"); }
    assert.equal((await brief.exited)[0], 0);
    const stuck = await hold();
    try {
      tick();
      await new Promise(resolve => setTimeout(resolve, 1200));
      tick(); tick();
      assert.equal(notes.length, 1);
      assert.match(notes[0], /owner\.json/);
    } finally { stuck.child.stdin.end("x"); }
    assert.equal((await stuck.exited)[0], 0);
    console.log("ATD-47: real-process brief and persistent lock checks passed");
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
