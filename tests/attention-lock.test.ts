// URN: test:pi-atdd:attention-lock:ATD-47
// Acceptance: acc:pi-atdd:atd-47-a01
// Acceptance: acc:pi-atdd:atd-47-a02
// Acceptance: acc:pi-atdd:atd-47-a03
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../src/attention-strip.ts";
import { DurableLockBusy, withDurableLock } from "../src/durable-lock.ts";
import { ensureKey, newItem, readSpool, signEvent, type LaunchConfig } from "../src/attention.ts";

function harness(root: string) {
  const handlers = new Map<string, Function>();
  const notes: string[] = [];
  const entries: any[] = [];
  let tick = () => {};
  let fences = 0;
  const ctx = { isProjectTrusted: () => true, sessionManager: { getBranch: () => entries },
    ui: { notify: (s: string) => notes.push(s), setWidget: () => {} } };
  const pi = { on: (n: string, fn: Function) => handlers.set(n, fn), registerTool: () => {},
    registerCommand: () => {}, appendEntry: (customType: string, data: unknown) => entries.push({type: "custom", customType, data}) };
  registerAttentionStrip(pi as any, { env: { PI_CODING_AGENT_DIR: root, PI_ATDD_ATTENTION_ROLE: "coach",
    PI_ATDD_ATTENTION_PROFILE: "test", PI_ATDD_ATTENTION_IDENTITY: "coach",
    PI_ATDD_ATTENTION_PROJECT_ID: "project", PI_ATDD_ATTENTION_COACH_ADDRESS: "coach@project" },
    authorize: () => true, fence: (_ctx, work) => { fences++; return work(); },
    setInterval: fn => { tick = fn; return fn; }, clearInterval: () => {} });
  return { notes, fences: () => fences, tick: () => tick(), start: () => handlers.get("session_start")!({}, ctx) };
}

test("ATD-47: complete newline records only, even during a split append", () => {
  const root = mkdtempSync(join(tmpdir(), "atd47-read-"));
  try {
    const path = join(root, "spool");
    const cfg: LaunchConfig = { role: "worker", identity: "w", profile: "test", spool: path, keyPath: join(root, "key") };
    const key = ensureKey(cfg.keyPath);
    const ev = signEvent({event: "raised", item: newItem({type: "review", summary: "hello"}, cfg, new Date())}, key);
    const line = JSON.stringify(ev) + "\n";
    writeFileSync(path, line.slice(0, 20));
    const partial = readSpool(path, cfg, key);
    assert.deepEqual(partial.events, []); assert.equal(partial.offset, 0);
    appendFileSync(path, line.slice(20));
    assert.deepEqual(readSpool(path, cfg, key, partial.offset).events, [ev]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("ATD-47 read during an actual concurrent append does not advance past a partial record", async () => {
  const root = mkdtempSync(join(tmpdir(), "atd47-concurrent-"));
  try {
    const path = join(root, "spool");
    const cfg: LaunchConfig = { role: "worker", identity: "w", profile: "test", spool: path, keyPath: join(root, "key") };
    const key = ensureKey(cfg.keyPath);
    const ev = signEvent({event: "raised", item: newItem({type: "review", summary: "concurrent"}, cfg, new Date())}, key);
    const line = JSON.stringify(ev) + "\n";
    const script = `const fs=require('fs'); const [path,line]=process.argv.slice(1); fs.appendFileSync(path,line.slice(0,20)); process.stdout.write('ready\\n'); process.stdin.once('data',()=>fs.appendFileSync(path,line.slice(20)))`;
    const child = spawn(process.execPath, ["-e", script, path, line], {stdio: ["pipe", "pipe", "inherit"]});
    const exited = once(child, "exit");
    await once(child.stdout, "data");
    const partial = readSpool(path, cfg, key);
    try { assert.deepEqual(partial.events, []); assert.equal(partial.offset, 0); }
    finally { child.stdin.end("continue"); }
    assert.equal((await exited)[0], 0);
    assert.deepEqual(readSpool(path, cfg, key, partial.offset).events, [ev]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("ATD-47 bounded writer wait succeeds after a brief hold and fails closed on a long hold", async () => {
  const root = mkdtempSync(join(tmpdir(), "atd47-wait-"));
  const file = join(root, "state");
  const script = `const fs=require('fs'); const [lock,ms]=process.argv.slice(1); fs.mkdirSync(lock); fs.writeFileSync(lock+'/owner.json',JSON.stringify({pid:process.pid,host:require('os').hostname(),at:Date.now()})); process.stdout.write('ready\\n'); const release=()=>fs.rmSync(lock,{recursive:true}); if(Number(ms)) setTimeout(release,Number(ms)); else process.stdin.once('data',release);`;
  const hold = async (ms: number) => {
    const child = spawn(process.execPath, ["-e", script, file + ".lock", String(ms)], {stdio: ["pipe", "pipe", "inherit"]});
    const exited = once(child, "exit");
    await once(child.stdout, "data");
    return { child, exited };
  };
  try {
    const first = await hold(70);
    assert.equal(withDurableLock(file, () => "acquired", 300), "acquired");
    first.child.stdin.end();
    assert.equal((await first.exited)[0], 0);
    const second = await hold(0);
    try {
      assert.throws(() => withDurableLock(file, () => assert.fail("must not steal"), 100), DurableLockBusy);
    } finally { second.child.stdin.end("release"); }
    assert.equal((await second.exited)[0], 0);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("ATD-47 idle lock is read-only and a persistent lock warns once", () => {
  const root = mkdtempSync(join(tmpdir(), "atd47-lock-"));
  try {
    const lock = join(root, "attention", "spool.jsonl.lock");
    mkdirSync(lock, {recursive: true});
    writeFileSync(join(lock, "owner.json"), JSON.stringify({pid: process.pid, host: hostname(), at: Date.now()}));
    const h = harness(root);
    assert.doesNotThrow(() => h.start());
    h.tick(); assert.deepEqual(h.notes, []); assert.equal(h.fences(), 0, "no write critical section for idle refresh");
    const old = new Date(Date.now() - 5000);
    utimesSync(lock, old, old);
    h.tick(); h.tick();
    assert.equal(h.notes.length, 1);
    assert.match(h.notes[0], /owner\.json/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
