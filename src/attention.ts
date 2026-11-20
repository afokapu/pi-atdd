/**
 * PLT-101 Attention Strip: pure domain (item schema, validation, fold, transitions)
 * and profile-scoped spool I/O. No Pi API here; attention-strip.ts wires it into Pi.
 *
 * One event shape serves both the shared spool file and the hidden Pi session entries.
 * Session entries are the Coach's source of truth; the spool is the worker-visible channel.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ATTENTION_TYPES = ["decision", "grant", "review", "intervention"] as const;
export type AttentionType = (typeof ATTENTION_TYPES)[number];
export type ResolveScope = "within_grant" | "owner_answer";
export type AttentionState = "open" | "acked" | "snoozed" | "resolved" | "cancelled";

export const CUSTOM_TYPE = "pi-atdd-attention";
export const WIDGET_KEY = "pi-atdd-attention";
export const RESOLUTION_TYPE = "pi-atdd-attention-resolution";
export const DEFAULT_TTL_HOURS = 72;
export const MAX_TTL_HOURS = 168;
export const MAX_TEXT = 280;

export type AttentionItem = {
  id: string;
  type: AttentionType;
  from: string;
  profile: string;
  issue: string | null;
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
  state: "acked" | "snoozed" | "resolved" | "cancelled";
  by: string;
  at: string;
  note?: string;
  scope?: ResolveScope;
  ownerAnswer?: string;
  snoozedUntil?: string;
};

/** Spool lines and hidden session entries share these shapes. */
export type AttentionEvent = { event: "raised"; item: AttentionItem } | { event: "state"; rec: StateRecord };
export type Cursor = { event: "ingested"; offset: number } | { event: "delivered"; id: string; revision: number };

export type LaunchConfig = { role: "worker" | "coach"; identity: string; profile: string; spool: string };

/** Launch config comes from the launcher's environment, never from model output. Absent role = inert. */
export function readLaunchConfig(env: NodeJS.ProcessEnv): LaunchConfig | undefined {
  const role = env.PI_ATDD_ATTENTION_ROLE;
  if (role === undefined || role === "") return undefined;
  if (role !== "worker" && role !== "coach") throw new Error("PI_ATDD_ATTENTION_ROLE must be worker or coach");
  const identity = env.PI_ATDD_ATTENTION_IDENTITY?.trim();
  const profile = env.PI_ATDD_ATTENTION_PROFILE?.trim();
  if (!identity || !profile) throw new Error("attention launch config incomplete: identity and profile are required");
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return { role, identity, profile, spool: join(agentDir, "attention", "spool.jsonl") };
}

function text(value: unknown, field: string, max = MAX_TEXT): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new Error(`${field} is required`);
  if (s.length > max) throw new Error(`${field} exceeds ${max} characters`);
  return s;
}

const plusHours = (from: Date, hours: number) => new Date(from.getTime() + hours * 3_600_000).toISOString();

/** Worker raise. `from` and `profile` come from launch config; any such fields in the input are ignored. */
export function newItem(input: Record<string, unknown>, cfg: LaunchConfig, now: Date): AttentionItem {
  const type = input.type;
  if (typeof type !== "string" || !(ATTENTION_TYPES as readonly string[]).includes(type))
    throw new Error(`type must be one of ${ATTENTION_TYPES.join(", ")}`);
  const hours = input.ttlHours === undefined ? DEFAULT_TTL_HOURS : input.ttlHours;
  if (typeof hours !== "number" || !(hours > 0 && hours <= MAX_TTL_HOURS))
    throw new Error(`ttlHours must be greater than 0 and at most ${MAX_TTL_HOURS}`);
  const issue = typeof input.issue === "string" && input.issue.trim() ? input.issue.trim() : null;
  return {
    id: "ati_" + randomBytes(6).toString("hex"),
    type: type as AttentionType,
    from: cfg.identity,
    profile: cfg.profile,
    issue,
    summary: text(input.summary, "summary"),
    createdAt: now.toISOString(),
    ttl: plusHours(now, hours),
    state: "open",
    revision: 1,
  };
}

/** Rebuild the item set from events. Higher revision wins; events apply in log order. */
export function fold(events: ReadonlyArray<AttentionEvent | Cursor>): Map<string, AttentionItem> {
  const items = new Map<string, AttentionItem>();
  for (const e of events) {
    if (e.event === "ingested" || e.event === "delivered") continue; // cursors, not item facts
    if (e.event === "raised") {
      if (!items.has(e.item.id)) items.set(e.item.id, { ...e.item });
      continue;
    }
    const it = items.get(e.rec.id);
    if (!it || e.rec.revision <= it.revision) continue;
    it.revision = e.rec.revision;
    it.state = e.rec.state;
    if (e.rec.state === "snoozed") it.snoozedUntil = e.rec.snoozedUntil;
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

/** Live = not resolved/cancelled and not past TTL. Expiry is computed, so it needs no event. */
export function isLive(it: AttentionItem, now: Date): boolean {
  return it.state !== "resolved" && it.state !== "cancelled" && Date.parse(it.ttl) > now.getTime();
}

/** A snooze that has run out shows as open again. */
export function effectiveState(it: AttentionItem, now: Date): AttentionState {
  if (it.state === "snoozed" && it.snoozedUntil && Date.parse(it.snoozedUntil) <= now.getTime()) return "open";
  return it.state;
}

export type Action =
  | { kind: "ack" }
  | { kind: "snooze"; hours: number }
  | { kind: "resolve"; scope: unknown; note: unknown; ownerAnswer?: unknown }
  | { kind: "cancel"; note: unknown };

/** Coach transition. Returns the state record to append. Throws on any rule violation. */
export function transition(item: AttentionItem | undefined, action: Action, cfg: LaunchConfig, now: Date): StateRecord {
  if (!item) throw new Error("unknown attention item");
  if (!isLive(item, now)) throw new Error(`attention item ${item.id} is not live (${item.state} or expired)`);
  const base = { id: item.id, from: item.from, revision: item.revision + 1, by: cfg.identity, at: now.toISOString() };
  switch (action.kind) {
    case "ack":
      if (item.state !== "open") throw new Error(`cannot ack a ${item.state} item`);
      return { ...base, state: "acked" };
    case "snooze": {
      if (!(action.hours > 0 && action.hours <= MAX_TTL_HOURS)) throw new Error(`hours must be greater than 0 and at most ${MAX_TTL_HOURS}`);
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

/** Read complete lines from `offset`. A partial last line is left for the next read. */
export function readSpool(path: string, offset = 0): { events: AttentionEvent[]; offset: number } {
  if (!existsSync(path)) return { events: [], offset };
  const buf = readFileSync(path);
  const events: AttentionEvent[] = [];
  let pos = offset;
  let next = offset;
  for (;;) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    const line = buf.subarray(pos, nl).toString("utf8");
    pos = nl + 1;
    next = pos;
    try {
      const ev = JSON.parse(line) as AttentionEvent;
      if (ev && (ev.event === "raised" || ev.event === "state")) events.push(ev);
    } catch {
      // A corrupt line is skipped, never repaired.
    }
  }
  return { events, offset: next };
}

export function appendSpool(path: string, ev: AttentionEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(ev) + "\n");
}

/** Coach ingests only items raised under its own profile, with a valid type and a stamped author. */
export function acceptableRaise(item: AttentionItem, cfg: LaunchConfig): boolean {
  return item.profile === cfg.profile && typeof item.from === "string" && item.from.length > 0 &&
    (ATTENTION_TYPES as readonly string[]).includes(item.type) && typeof item.summary === "string";
}
