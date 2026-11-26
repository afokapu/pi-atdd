// URN: test:pi-atdd:durable-lock:PLT-117
// Acceptance: acc:pi-atdd:plt-117-a03
// Acceptance: acc:pi-atdd:plt-117-a05
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { withDurableLock } from "../src/durable-lock.ts";

test("PLT-117 A03: active writer blocks competing mutations and releases the lock", () => {
  const root = mkdtempSync(join(tmpdir(), "atdd-lock-"));
  const file = join(root, "state.json");
  try {
    withDurableLock(file, () => {
      assert.throws(() => withDurableLock(file, () => {}), /locked/);
      writeFileSync(file, "owner-wrote");
    });
    assert.equal(withDurableLock(file, () => readFileSync(file, "utf8")), "owner-wrote");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PLT-117 A05: dead local owner may be reclaimed after grace period", () => {
  const root = mkdtempSync(join(tmpdir(), "atdd-lock-"));
  const file = join(root, "state.json"), lock = file + ".lock";
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({
      pid: 2147483647, host: hostname(), at: Date.now() - 120_000,
    }));
    assert.equal(withDurableLock(file, () => "recovered"), "recovered");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PLT-117 A05: missing identity or live owner never authorizes lock stealing", () => {
  const root = mkdtempSync(join(tmpdir(), "atdd-lock-"));
  const file = join(root, "state.json"), lock = file + ".lock";
  try {
    mkdirSync(lock);
    assert.throws(() => withDurableLock(file, () => {}), /locked/);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({
      pid: process.pid, host: hostname(), at: Date.now() - 120_000,
    }));
    assert.throws(() => withDurableLock(file, () => {}), /locked/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
