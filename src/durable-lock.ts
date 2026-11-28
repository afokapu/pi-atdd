/**
 * ATDD local append/lease serialization. A dead process's lock may be reclaimed
 * only when its recorded PID is dead on this same machine. Unknown ownership
 * stays locked; no timeout ever authorizes stealing from a live process.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
const GRACE_MS = 30_000;

type LockOwner = { pid: number; host: string; at: number };
const ownerPath = (lock: string) => join(lock, "owner.json");
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
};
function reclaimDeadLock(lock: string): boolean {
  const recovery = lock + ".recovery";
  try { mkdirSync(recovery); } catch { return false; }
  try {
    if (!existsSync(lock)) return true;
    let owner: LockOwner;
    try { owner = JSON.parse(readFileSync(ownerPath(lock), "utf8")) as LockOwner; }
    catch { return false; } // crash before owner publication: manual inspection required
    if (!Number.isInteger(owner.pid) || owner.pid <= 0 || owner.host !== hostname() ||
        !Number.isFinite(owner.at) || Date.now() - owner.at < GRACE_MS ||
        alive(owner.pid)) return false;
    // A single recovery mutex prevents two reclaimers from deleting a new lock.
    rmSync(lock, { recursive: true });
    return true;
  } finally { rmSync(recovery, { recursive: true }); }
}

/**
 * True only when a recorded process is provably gone on this machine. A live PID, another
 * host, or a malformed record is not dead, so recovery built on it stays refused.
 */
export function holderIsDead(pid: number, host: string): boolean {
  return Number.isInteger(pid) && pid > 0 && host === hostname() && !alive(pid);
}

export class DurableLockBusy extends Error {
  constructor(lock: string) { super(`durable ATDD state is locked; inspect ${ownerPath(lock)}`); }
}

/** Fails closed on contention; an optional bounded wait is used only by refresh. */
export function withDurableLock<T>(file: string, work: () => T, waitMs = 0): T {
  mkdirSync(dirname(file), { recursive: true });
  const lock = file + ".lock";
  const deadline = Date.now() + waitMs;
  let acquired = false;
  for (;;) {
    try { mkdirSync(lock); acquired = true; break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (reclaimDeadLock(lock)) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DurableLockBusy(lock);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(remaining, 10 + Math.random() * 20));
    }
  }
  if (!acquired) throw new DurableLockBusy(lock);
  try {
    writeFileSync(ownerPath(lock), JSON.stringify({ pid: process.pid,
      host: hostname(), at: Date.now() } satisfies LockOwner), { flag: "wx", mode: 0o600 });
    return work();
  } finally {
    // Never delete another owner's lock. Only this process created this directory.
    rmSync(lock, { recursive: true });
  }
}
