/**
 * PLT-101 Attention Strip: domain (schema, authenticity, fold, transitions) and
 * profile-scoped spool I/O. No Pi API here; attention-strip.ts wires it into Pi.
 *
 * Authenticity: every raised item and every state record carries an HMAC-SHA256 over its
 * canonical body, keyed by the profile's attention key (<agentDir>/attention/attention.key,
 * created mode 0600). Records that are unsigned, mis-signed, malformed or belong to another
 * profile are dropped on read. Limit: any process running as the same OS user can read the key
 * file. This stops forgery by writes that do not hold the key (raw shell appends, injected text,
 * cross-profile records). It does not stop a deliberate read of the key file.
 *
 * Operational memory: resolved, cancelled and expired items are dropped by operational(); the
 * Coach records an explicit "expired" state when a TTL runs out.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { renameSync, rmSync } from "node:fs";
import { withDurableLock } from "./durable-lock.ts";
import { coachOwnsAttention, taskOwnsAttention, isValidAttentionRoute, readAttentionRouteBinding,
  routeFromWorkerBinding, type AttentionRoute, type AttentionRouteBinding } from "./attention-routing.ts";

export const ATTENTION_TYPES = ["decision", "grant", "review", "intervention"] as const;
export type AttentionType = (typeof ATTENTION_TYPES)[number];
export type ResolveScope = "within_grant" | "owner_answer";
export type AttentionState = "open" | "acked" | "snoozed" | "resolved" | "cancelled" | "expired";

const STATES: readonly string[] = ["open", "acked", "snoozed", "resolved", "cancelled", "expired"];
const TERMINAL: ReadonlySet<string> = new Set(["resolved", "cancelled", "expired"]);

export const CUSTOM_TYPE = "pi-atdd-attention";
export const WIDGET_KEY = "pi-atdd-attention";
export const RESOLUTION_TYPE = "pi-atdd-attention-resolution";
export const DEFAULT_TTL_HOURS = 72;
export const MAX_TTL_HOURS = 168;
export const MAX_TEXT = 280;
export const MAX_ISSUE = 64;

export type AttentionItem = {
  id: string;
  type: AttentionType;
  from: string;
  profile: string;
  issue: string | null;
  /** Immutable launcher-stamped recipient; absent only on legacy records. */
  route?: AttentionRoute;
  summary: string;
  createdAt: string;
  ttl: string;
  state: AttentionState;
  snoozedUntil?: string;
  revision: number;
  resolution?: { by: string; note: string; at: string; scope?: ResolveScope; ownerAnswer?: string };
};

export type StateRecord = {
  id: string;
  from: string;
  revision: number;
  state: Exclude<AttentionState, "open">;
  by: string;
  at: string;
  route?: AttentionRoute;
  note?: string;
  scope?: ResolveScope;
  ownerAnswer?: string;
  snoozedUntil?: string;
};

/** Spool lines and hidden session entries share these signed shapes. */
export type SignedEvent =
  | { event: "raised"; item: AttentionItem; mac: string }
  | { event: "state"; rec: StateRecord; mac: string };
export type Cursor = { event: "ingested"; offset: number } | { event: "delivered"; id: string; revision: number };

export type LaunchConfig = {
  role: "worker" | "reviewer" | "coach";
  route?: AttentionRouteBinding;
  identity: string;
  profile: string;
  spool: string;
  keyPath: string;
};

/** Launch config comes from the launcher's environment, never from model output. Absent role = inert. */
export function readLaunchConfig(env: NodeJS.ProcessEnv): LaunchConfig | undefined {
  const role = env.PI_ATDD_ATTENTION_ROLE;
  if (role === undefined || role === "") return undefined;
  if (role !== "worker" && role !== "reviewer" && role !== "coach")
    throw new Error("PI_ATDD_ATTENTION_ROLE must be worker, reviewer or coach");
  const identity = env.PI_ATDD_ATTENTION_IDENTITY?.trim();
  const profile = env.PI_ATDD_ATTENTION_PROFILE?.trim();
  if (!identity || !profile) throw new Error("attention launch config incomplete: identity and profile are required");
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return {
    role, identity, profile,
    ...(readAttentionRouteBinding(env, role === "coach" ? "coach" : "worker")
      ? { route: readAttentionRouteBinding(env, role === "coach" ? "coach" : "worker") } : {}),
    spool: join(agentDir, "attention", "spool.jsonl"),
    keyPath: join(agentDir, "attention", "attention.key"),
  };
}

/** Per-profile HMAC key. Created once with mode 0600; the same file is read by both roles. */
export function ensureKey(keyPath: string): Buffer {
  mkdirSync(dirname(keyPath), { recursive: true });
  try {
    writeFileSync(keyPath, randomBytes(32).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const hex = readFileSync(keyPath, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("attention key file is malformed");
  return Buffer.from(hex, "hex");
}

/** Stable JSON: sorted keys, undefined dropped, so signer and verifier see the same bytes. */
export function canon(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return "{" + Object.keys(o).filter(k => o[k] !== undefined).sort()
      .map(k => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

const macOf = (body: unknown, key: Buffer) => createHmac("sha256", key).update(canon(body)).digest("hex");

function macOk(body: unknown, mac: unknown, key: Buffer): boolean {
  if (typeof mac !== "string" || !/^[0-9a-f]{64}$/.test(mac)) return false;
  return timingSafeEqual(Buffer.from(macOf(body, key), "hex"), Buffer.from(mac, "hex"));
}

export function signEvent(
  body: { event: "raised"; item: AttentionItem } | { event: "state"; rec: StateRecord },
  key: Buffer,
): SignedEvent {
  return { ...body, mac: macOf(body, key) } as SignedEvent;
}

const isId = (v: unknown): v is string => typeof v === "string" && /^ati_[0-9a-f]{12}$/.test(v);
const isText = (v: unknown, max = MAX_TEXT): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isRev = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1;
const absentOr = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);

function validItem(x: unknown): x is AttentionItem {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return isId(o.id) && (ATTENTION_TYPES as readonly unknown[]).includes(o.type) &&
    isText(o.from, 200) && isText(o.profile, 200) && (o.issue === null || isText(o.issue, MAX_ISSUE)) &&
    isText(o.summary) && isIso(o.createdAt) && isIso(o.ttl) && STATES.includes(o.state as string) &&
    isRev(o.revision) && absentOr(o.snoozedUntil, isIso) &&
    absentOr(o.route, x => isValidAttentionRoute(x as AttentionRoute));
}

function validRec(x: unknown): x is StateRecord {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return isId(o.id) && isText(o.from, 200) && isRev(o.revision) &&
    ["acked", "snoozed", "resolved", "cancelled", "expired"].includes(o.state as string) &&
    isText(o.by, 200) && isIso(o.at) &&
    absentOr(o.note, x => typeof x === "string") &&
    absentOr(o.scope, x => x === "within_grant" || x === "owner_answer") &&
    absentOr(o.ownerAnswer, x => typeof x === "string") &&
    absentOr(o.snoozedUntil, isIso) && absentOr(o.route, x => isValidAttentionRoute(x as AttentionRoute));
}

/** A record counts only if it is well-formed, belongs to this profile and carries a valid MAC. */
export function verifyEvent(raw: unknown, cfg: LaunchConfig, key: Buffer): SignedEvent | undefined {
  return verify(raw, cfg, key, true);
}

/**
 * Authentic for this profile (shape, profile, MAC) whatever its recipient. A reader that must tell
 * "another coach's record" from a corrupt line uses this; it never shows or copies the record.
 */
export function verifyAuthentic(raw: unknown, cfg: LaunchConfig, key: Buffer): SignedEvent | undefined {
  return verify(raw, cfg, key, false);
}

/** PLT-118 review P1 A01: a state record reaches a reader only on the item route it belongs to. */
function stateVisible(rec: StateRecord, cfg: LaunchConfig): boolean {
  const route = cfg.route;
  if (!route) return rec.route === undefined;
  if (!rec.route) return false;
  return route.role === "coach"
    ? coachOwnsAttention({ route: rec.route }, route) : taskOwnsAttention({ route: rec.route }, route);
}

function verify(raw: unknown, cfg: LaunchConfig, key: Buffer, recipient: boolean): SignedEvent | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (o.event === "raised") {
    const item = o.item;
    if (!validItem(item) || item.profile !== cfg.profile) return undefined;
    if (recipient) {
      if (cfg.route) {
        const matches = cfg.route.role === "coach"
          ? coachOwnsAttention(item, cfg.route) : taskOwnsAttention(item, cfg.route);
        if (!matches) return undefined;
      } else if (item.route) return undefined; // Never broadcast routed records to a legacy coach.
    }
    return macOk({ event: "raised", item }, o.mac, key) ? { event: "raised", item, mac: o.mac as string } : undefined;
  }
  if (o.event === "state") {
    const rec = o.rec;
    if (!validRec(rec) || (rec.route && rec.route.profile !== cfg.profile)) return undefined;
    if (recipient && !stateVisible(rec, cfg)) return undefined;
    return macOk({ event: "state", rec }, o.mac, key) ? { event: "state", rec, mac: o.mac as string } : undefined;
  }
  return undefined;
}

/** Worker raise. `from` and `profile` come from launch config; any such fields in the input are ignored. */
export function newItem(input: Record<string, unknown>, cfg: LaunchConfig, now: Date): AttentionItem {
  const type = input.type;
  if (typeof type !== "string" || !(ATTENTION_TYPES as readonly string[]).includes(type))
    throw new Error(`type must be one of ${ATTENTION_TYPES.join(", ")}`);
  const hours = input.ttlHours === undefined ? DEFAULT_TTL_HOURS : input.ttlHours;
  if (typeof hours !== "number" || !(hours > 0 && hours <= MAX_TTL_HOURS))
    throw new Error(`ttlHours must be greater than 0 and at most ${MAX_TTL_HOURS}`);
  const issue = typeof input.issue === "string" && input.issue.trim() ? input.issue.trim() : null;
  if (issue !== null && issue.length > MAX_ISSUE) throw new Error(`issue exceeds ${MAX_ISSUE} characters`);
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary) throw new Error("summary is required");
  if (summary.length > MAX_TEXT) throw new Error(`summary exceeds ${MAX_TEXT} characters`);
  return {
    id: "ati_" + randomBytes(6).toString("hex"),
    type: type as AttentionType,
    from: cfg.identity,
    profile: cfg.profile,
    issue,
    ...(cfg.route && cfg.route.role === "worker"
      ? { route: routeFromWorkerBinding(cfg.route) } : {}),
    summary,
    createdAt: now.toISOString(),
    ttl: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    state: "open",
    revision: 1,
  };
}

/** Every item, including closed ones (used for transitions and summaries). */
export function foldAll(events: ReadonlyArray<SignedEvent>): Map<string, AttentionItem> {
  const items = new Map<string, AttentionItem>();
  for (const e of events) {
    if (e.event === "raised") {
      if (!items.has(e.item.id)) items.set(e.item.id, { ...e.item });
      continue;
    }
    const it = items.get(e.rec.id);
    if (!it || TERMINAL.has(it.state) || e.rec.from !== it.from || e.rec.revision <= it.revision) continue;
    // A signed state can only mutate the task and logical recipient of its original raise.
    if (JSON.stringify(e.rec.route ?? null) !== JSON.stringify(it.route ?? null)) continue;
    it.revision = e.rec.revision;
    it.state = e.rec.state;
    if (e.rec.state === "snoozed") it.snoozedUntil = e.rec.snoozedUntil;
    else delete it.snoozedUntil;
    if (e.rec.state === "resolved" || e.rec.state === "cancelled") {
      it.resolution = {
        by: e.rec.by, note: e.rec.note ?? "", at: e.rec.at,
        ...(e.rec.scope ? { scope: e.rec.scope } : {}),
        ...(e.rec.ownerAnswer ? { ownerAnswer: e.rec.ownerAnswer } : {}),
      };
    }
  }
  return items;
}

/** Live = not resolved, cancelled or expired, and not past TTL. */
export function isLive(it: AttentionItem, now: Date): boolean {
  return !TERMINAL.has(it.state) && Date.parse(it.ttl) > now.getTime();
}

/** Operational memory: closed and TTL-expired items are removed. */
export function operational(all: ReadonlyMap<string, AttentionItem>, now: Date): Map<string, AttentionItem> {
  const live = new Map<string, AttentionItem>();
  for (const [id, it] of all) if (isLive(it, now)) live.set(id, it);
  return live;
}

export function fold(events: ReadonlyArray<SignedEvent>, now: Date): Map<string, AttentionItem> {
  return operational(foldAll(events), now);
}

/** A snooze that has run out shows as open again. */
export function effectiveState(it: AttentionItem, now: Date): string {
  if (it.state === "snoozed" && it.snoozedUntil && Date.parse(it.snoozedUntil) <= now.getTime()) return "open";
  return it.state;
}

/** Coach-recorded expiry for every non-closed item whose TTL has run out. */
export function expiryRecords(all: ReadonlyMap<string, AttentionItem>, now: Date, cfg: LaunchConfig): StateRecord[] {
  const out: StateRecord[] = [];
  for (const it of all.values()) {
    if (TERMINAL.has(it.state) || Date.parse(it.ttl) > now.getTime()) continue;
    out.push({
      id: it.id, from: it.from, revision: it.revision + 1, state: "expired",
      by: cfg.identity, at: now.toISOString(), note: "ttl expired",
      ...(it.route ? { route: it.route } : {}),
    });
  }
  return out;
}

export type Action =
  | { kind: "ack" }
  | { kind: "snooze"; hours: number }
  | { kind: "resolve"; scope: unknown; note: unknown; ownerAnswer?: unknown }
  | { kind: "cancel"; note: unknown };

function text(value: unknown, field: string, max = MAX_TEXT): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new Error(`${field} is required`);
  if (s.length > max) throw new Error(`${field} exceeds ${max} characters`);
  return s;
}

/** Coach transition. Returns the state record to record. Throws on any rule violation. */
export function transition(item: AttentionItem | undefined, action: Action, cfg: LaunchConfig, now: Date): StateRecord {
  if (!item) throw new Error("unknown attention item");
  if (TERMINAL.has(item.state)) throw new Error(`attention item ${item.id} is already ${item.state}`);
  if (Date.parse(item.ttl) <= now.getTime()) throw new Error(`attention item ${item.id} has expired`);
  if (cfg.role !== "coach") throw new Error("only the Coach may change attention state");
  if (cfg.route && (cfg.route.role !== "coach" || !coachOwnsAttention(item, cfg.route)))
    throw new Error("attention item belongs to another coach");
  const base = { id: item.id, from: item.from, revision: item.revision + 1, by: cfg.identity, at: now.toISOString(),
    ...(item.route ? { route: item.route } : {}) };
  switch (action.kind) {
    case "ack":
      if (item.state !== "open") throw new Error(`cannot ack a ${item.state} item`);
      return { ...base, state: "acked" };
    case "snooze": {
      if (!(action.hours > 0 && action.hours <= MAX_TTL_HOURS))
        throw new Error(`hours must be greater than 0 and at most ${MAX_TTL_HOURS}`);
      const until = Math.min(now.getTime() + action.hours * 3_600_000, Date.parse(item.ttl));
      return { ...base, state: "snoozed", snoozedUntil: new Date(until).toISOString() };
    }
    case "resolve": {
      if (action.scope !== "within_grant" && action.scope !== "owner_answer")
        throw new Error("scope must be within_grant or owner_answer");
      const note = text(action.note, "note");
      if (action.scope === "within_grant") return { ...base, state: "resolved", note, scope: "within_grant" };
      const ownerAnswer = typeof action.ownerAnswer === "string" ? action.ownerAnswer.trim() : "";
      if (!ownerAnswer) throw new Error("scope owner_answer requires a non-empty ownerAnswer (the owner's answer)");
      return { ...base, state: "resolved", note, scope: "owner_answer", ownerAnswer };
    }
    case "cancel":
      if (cfg.role !== "coach") throw new Error("only the Coach can cancel");
      return { ...base, state: "cancelled", note: text(action.note, "note") };
  }
}

/**
 * Complete lines from `offset`. Malformed and unverified lines are skipped, never repaired.
 * A partial last line is left for the next read. An offset past the end means the file was replaced.
 */
export function readSpool(path: string, cfg: LaunchConfig, key: Buffer, offset = 0): { events: SignedEvent[]; offset: number } {
  if (!existsSync(path)) return { events: [], offset };
  const buf = readFileSync(path);
  const events: SignedEvent[] = [];
  let pos = offset > buf.length ? 0 : offset;
  for (;;) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const line = buf.subarray(pos, nl).toString("utf8");
    pos = nl + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const ev = verifyEvent(raw, cfg, key);
    if (ev) events.push(ev);
  }
  return { events, offset: pos };
}

/** A torn previous write must not swallow the next record: start on a fresh line when needed. */
export function appendSpool(path: string, ev: SignedEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  const torn = current.length > 0 && current[current.length - 1] !== 10;
  appendFileSync(path, (torn ? "\n" : "") + JSON.stringify(ev) + "\n");
}

/**
 * One writer at a time for spool state transitions. Locks are not stolen on a
 * timeout: a crash leaves a diagnosable recovery obligation, never two owners.
 */
export const withAttentionLock = withDurableLock;

/** Durable task-level delivery receipt, shared by successive authorized worker sessions. */
function receiptPath(cfg: LaunchConfig): string | undefined {
  if (!cfg.route || cfg.route.role !== "worker") return undefined;
  const route = cfg.route;
  const hash = createHash("sha256").update(JSON.stringify([
    route.profile, route.projectId, route.taskId, route.coachAddress])).digest("hex").slice(0, 32);
  return join(dirname(cfg.spool), "deliveries", hash + ".json");
}
export function readTaskReceipts(cfg: LaunchConfig): Map<string, number> {
  const path = receiptPath(cfg);
  if (!path) return new Map();
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Map(); throw e; }
  const o: unknown = JSON.parse(raw);
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("malformed task attention receipt");
  const receipts = new Map<string, number>();
  for (const [id, rev] of Object.entries(o)) {
    if (!isId(id) || !isRev(rev)) throw new Error("malformed task attention receipt");
    receipts.set(id, rev as number);
  }
  return receipts;
}
/**
 * Advances receipts only while `mayCommit` holds, checked inside the receipt lock (PLT-118 review
 * P1 A05/A06). Returns false, writing nothing, when the seat no longer owns the route.
 */
export function commitTaskReceipts(cfg: LaunchConfig, delivered: ReadonlyMap<string, number>,
  mayCommit: () => boolean = () => true): boolean {
  const path = receiptPath(cfg);
  if (!path || delivered.size === 0) return true;
  return withAttentionLock(path, () => {
    if (!mayCommit()) return false;
    const merged = readTaskReceipts(cfg);
    for (const [id, revision] of delivered) {
      if (!isId(id) || !isRev(revision)) throw new Error("invalid attention receipt");
      merged.set(id, Math.max(revision, merged.get(id) ?? 0));
    }
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(merged)) + "\n", { flag: "wx", mode: 0o600 });
      renameSync(tmp, path);
    } finally { rmSync(tmp, { force: true }); }
    return true;
  });
}
