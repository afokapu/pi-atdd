/**
 * PLT-101 Pi wiring for the Attention Strip. Domain rules live in attention.ts.
 * Inert unless PI_ATDD_ATTENTION_ROLE is set. Every entry point (tools, command, hooks)
 * checks the project trust gate; tools fail closed when they receive no extension context.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ATTENTION_TYPES, CUSTOM_TYPE, RESOLUTION_TYPE, WIDGET_KEY, appendSpool, effectiveState, ensureKey,
  expiryRecords, fold, foldAll, newItem, operational, readLaunchConfig, readSpool, signEvent, transition,
  commitTaskReceipts, readTaskReceipts, withAttentionLock,
  verifyEvent,
  type Action, type AttentionItem, type Cursor, type LaunchConfig, type SignedEvent, type StateRecord,
} from "./attention.ts";
import type { AttentionRouteBinding } from "./attention-routing.ts";
import { seatAuthorizationRefusal } from "./execution-seat.ts";

export type StripOptions = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  pollMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Required for scoped launches: the seat must own this exact route at each action (PLT-118 review P1 A01/A02). */
  authorize?: (ctx: unknown, route: AttentionRouteBinding) => boolean;
  /**
   * The route in force for this session, derived from the CURRENT authorized seat binding, or undefined
   * when the session is not authorized. Replaces `authorize`: PLT-117 recovery rotates the execution id
   * in process, so the launch route alone would reject an authorized successor (PLT-118 fix P1 A05).
   */
  liveRoute?: (ctx: unknown, launched: AttentionRouteBinding) => AttentionRouteBinding | undefined;
  /** Runs a write while no seat transfer can commit; throws when the seat is not owned (fix P1 A02/A05/A06). */
  fence?: <T>(ctx: unknown, work: () => T) => T;
};

/** The subset of Pi's extension context this module uses. */
type Ctx = {
  isProjectTrusted: () => boolean;
  sessionManager: { getBranch: () => unknown[] };
  ui: {
    notify: (message: string, level?: string) => void;
    setWidget: (key: string, lines: string[] | undefined) => void;
  };
};
type Api = {
  on: (name: string, fn: (event: unknown, ctx: Ctx) => unknown) => void;
  registerTool: (def: unknown) => void;
  registerCommand: (name: string, def: unknown) => void;
  appendEntry: (customType: string, data: unknown) => void;
  sendMessage?: (message: { customType: string; content: string; display: boolean; details?: Record<string, unknown> },
    options: { triggerTurn: boolean; deliverAs: "followUp" }) => void;
};

const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });
const textResult = (message: string, details: Record<string, unknown>) =>
  ({ content: [{ type: "text", text: message }], details });

const trusted = (ctx: unknown): ctx is Ctx =>
  typeof (ctx as Partial<Ctx> | null | undefined)?.isProjectTrusted === "function" &&
  (ctx as Ctx).isProjectTrusted() === true;

function requireTrusted(ctx: unknown): asserts ctx is Ctx {
  if (!trusted(ctx)) throw new Error("ATDD attention requires a trusted project");
}
/** The launch config with the route in force right now, or undefined when this session is not authorized. */
function effective(ctx: unknown, cfg: LaunchConfig, opts: StripOptions): LaunchConfig | undefined {
  if (!trusted(ctx)) return undefined;
  if (!cfg.route) return cfg;
  if (opts.liveRoute) {
    const route = opts.liveRoute(ctx, cfg.route);
    return route ? { ...cfg, route } : undefined;
  }
  return opts.authorize?.(ctx, cfg.route) === true ? cfg : undefined;
}
const authorized = (ctx: unknown, cfg: LaunchConfig, opts: StripOptions) => effective(ctx, cfg, opts) !== undefined;
const fenced = <T>(ctx: unknown, opts: StripOptions, work: () => T): T => opts.fence ? opts.fence(ctx, work) : work();

/** An errored run never reached the model's answer, so its resolutions are not delivered. Read from agent_end. */
const endedWithError = (event: unknown): boolean => {
  const messages = (event as { messages?: unknown[] } | undefined)?.messages ?? [];
  const last = messages.at(-1) as { role?: string; stopReason?: string } | undefined;
  return last?.role === "assistant" && last.stopReason === "error";
};
function requireAuthorized(ctx: unknown, cfg: LaunchConfig, opts: StripOptions): LaunchConfig {
  requireTrusted(ctx);
  const current = effective(ctx, cfg, opts);
  if (!current) throw new Error(seatAuthorizationRefusal(opts.env ?? process.env));
  return current;
}

type Entry = { type?: string; customType?: string; data?: unknown };
const ours = (ctx: Ctx): unknown[] =>
  (ctx.sessionManager.getBranch() as Entry[])
    .filter(e => e.type === "custom" && e.customType === CUSTOM_TYPE)
    .map(e => e.data);

function isCursor(d: unknown): d is Cursor {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return (o.event === "ingested" && Number.isInteger(o.offset)) ||
    (o.event === "delivered" && typeof o.id === "string" && Number.isInteger(o.revision));
}

/** Verified attention records from this Coach or worker session. Other entries are ignored. */
const sessionEvents = (ctx: Ctx, cfg: LaunchConfig, key: Buffer): SignedEvent[] =>
  ours(ctx).flatMap(d => {
    const ev = verifyEvent(d, cfg, key);
    return ev ? [ev] : [];
  });

const keyOf = (ev: SignedEvent) =>
  ev.event === "raised" ? "raised:" + ev.item.id : "state:" + ev.rec.id + ":" + ev.rec.revision;

/** `liveItems` is the Coach's last rendered open items (PLT-122 coach-state); undefined when not a Coach or never rendered. */
export type StripHandle = { liveItems: () => string[] | undefined };

export function registerAttentionStrip(pi: ExtensionAPI, options: StripOptions = {}): StripHandle {
  const none: StripHandle = { liveItems: () => undefined };
  // ATD-36: an incomplete route is refused by the execution-pi session_start safeguard, not by a load crash.
  let cfg: LaunchConfig | undefined;
  try { cfg = readLaunchConfig(options.env ?? process.env); } catch { return none; }
  if (!cfg) return none;
  const now = options.now ?? (() => new Date());
  const api = pi as unknown as Api;
  if (cfg.role === "worker" || cfg.role === "reviewer") { registerWorker(api, cfg, now, options); return none; }
  return registerCoach(api, cfg, now, options);
}

const LIST_LIMIT = 25;
const squash = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Model-visible attention list: bounded details a Coach can read and resolve from (PLT-125). */
function listText(items: ReadonlyArray<AttentionItem>, at: Date): string {
  if (!items.length) return "0 current attention item(s)";
  const lines = items.slice(0, LIST_LIMIT).map(it => `- ${it.id} [${it.type}] ${effectiveState(it, at)}` +
    (it.issue ? ` ${it.issue}` : "") + ` from ${it.from}: ${it.summary.slice(0, 280)}`);
  const more = items.length > LIST_LIMIT ? `\n${items.length - LIST_LIMIT} more item(s) not shown.` : "";
  return `${items.length} current attention item(s):\n${lines.join("\n")}${more}\n` +
    "Resolve with attention_resolve (id, scope, note); acknowledge with attention_ack.";
}

/** A still-live item from the same task (or sender) with the same type, issue and summary. */
function findOpenDuplicate(raised: AttentionItem, events: ReadonlyArray<SignedEvent>, at: Date): AttentionItem | undefined {
  return [...fold(events, at).values()].find(it => it.type === raised.type && it.issue === raised.issue &&
    squash(it.summary) === squash(raised.summary) &&
    (raised.route ? it.route?.taskId === raised.route.taskId && it.route.coachAddress === raised.route.coachAddress
      : it.from === raised.from));
}

function registerWorker(api: Api, cfg: LaunchConfig, now: () => Date, opts: StripOptions): void {
  const key = () => ensureKey(cfg.keyPath);
  const pending = new Map<string, number>();
  api.registerTool({
    name: "attention_raise",
    label: "Raise attention",
    description: "Raise a typed attention item to the Coach: decision, grant, review or intervention.",
    parameters: schema({
      type: { type: "string", enum: [...ATTENTION_TYPES] },
      summary: { type: "string", description: "One line, at most 280 characters" },
      issue: { type: "string", description: "Linear identifier, e.g. PLT-101" },
      ttlHours: { type: "number", description: "Default 72, maximum 168" },
    }, ["type", "summary"]),
    execute: async (_id: string, params: Record<string, unknown>, _signal: unknown, _update: unknown, ctx: unknown) => {
      requireTrusted(ctx);
      // Ownership is decided inside the seat fence and the spool lock, in the same step as the write.
      const outcome = fenced(ctx, opts, () => withAttentionLock(cfg.spool, () => {
        const current = requireAuthorized(ctx, cfg, opts);
        const raised = newItem(params, current, now());
        // A successor replays work from the record: an equal item still open is not raised twice (PLT-125).
        const existing = findOpenDuplicate(raised, readSpool(current.spool, current, key()).events, now());
        if (existing) return { item: existing, duplicate: true };
        appendSpool(cfg.spool, signEvent({ event: "raised", item: raised }, key()));
        return { item: raised, duplicate: false };
      }));
      const item = outcome.item;
      return outcome.duplicate
        ? textResult(`${item.id} (${item.type}) is already open with the same summary; not raised again. The Coach sees it on its next refresh.`, { id: item.id, item, duplicate: true })
        : textResult(`Raised ${item.id} (${item.type}). The Coach sees it on its next refresh.`, { id: item.id, item });
    },
  });
  api.registerTool({
    name: "attention_status",
    label: "Attention status",
    description: "Show the open attention items this worker raised. Resolved, cancelled and expired items are removed.",
    parameters: schema({ id: { type: "string" } }, []),
    execute: async (_id: string, params: Record<string, unknown>, _signal: unknown, _update: unknown, ctx: unknown) => {
      const current = requireAuthorized(ctx, cfg, opts);
      const mine = [...fold(readSpool(current.spool, current, key()).events, now()).values()]
        .filter(it => current.route ? it.route?.taskId === (current.route.role === "worker" ? current.route.taskId : "") : it.from === current.identity);
      if (typeof params.id === "string") {
        const item = mine.find(it => it.id === params.id);
        return item
          ? textResult(`${item.id}: ${item.state}`, { item })
          : textResult("not found: closed or expired items leave operational memory; the outcome arrives on your next turn",
            { item: undefined });
      }
      return textResult(`${mine.length} item(s)`, { items: mine });
    },
  });
  api.on("session_start", () => pending.clear());
  api.on("before_agent_start", (_event, ctx) => {
    const current = effective(ctx, cfg, opts);
    if (!current) return undefined;
    return deliverResolutions(api, ctx, current, key(), pending);
  });
  let runFailed = false;
  api.on("agent_end", (event: unknown) => { runFailed = endedWithError(event); });
  api.on("agent_settled", (event, ctx) => {
    const failed = runFailed;
    runFailed = false;
    if (pending.size === 0) return;
    // A cancelled or errored run did not deliver the resolution: release it so the next turn retries.
    if ((event as { aborted?: boolean })?.aborted === true || failed) { pending.clear(); return; }
    // A settled, successful turn is the durable evidence of model delivery. Ownership is checked
    // inside the receipt lock, in the same step as the write (PLT-118 review P1 A05/A06).
    // If it crashed before settling, replay is intentionally at-least-once.
    const may = () => authorized(ctx, cfg, opts);
    let committed = false;
    try { committed = cfg.route ? fenced(ctx, opts, () => commitTaskReceipts(cfg, pending, may)) : may(); }
    catch { committed = false; } // a lost seat writes nothing; the successor replays the resolution
    if (committed) for (const [id, revision] of pending) api.appendEntry(CUSTOM_TYPE, { event: "delivered", id, revision });
    pending.clear();
  });
}

/** The worker sees each Coach state change for its own items once, on its next turn. */
function deliverResolutions(api: Api, ctx: Ctx, cfg: LaunchConfig, k: Buffer,
  pending: Map<string, number>) {
  const delivered = new Map<string, number>();
  for (const d of ours(ctx)) {
    if (isCursor(d) && d.event === "delivered") delivered.set(d.id, Math.max(delivered.get(d.id) ?? 0, d.revision));
  }
  if (cfg.route) for (const [id, revision] of readTaskReceipts(cfg))
    delivered.set(id, Math.max(revision, delivered.get(id) ?? 0));
  for (const [id, revision] of pending)
    delivered.set(id, Math.max(revision, delivered.get(id) ?? 0));
  const events = readSpool(cfg.spool, cfg, k).events;
  const items = foldAll(events);
  // Every revision the worker has not seen, in spool order (PLT-118 review P2 A05).
  const undelivered = new Map<string, StateRecord>();
  for (const ev of events) {
    if (ev.event !== "state" || !items.has(ev.rec.id) ||
      (!cfg.route && ev.rec.from !== cfg.identity)) continue;
    if (ev.rec.revision > (delivered.get(ev.rec.id) ?? 1)) undelivered.set(ev.rec.id + "\u0000" + ev.rec.revision, ev.rec);
  }
  if (undelivered.size === 0) return undefined;
  const lines = [...undelivered.values()].map(rec => {
    const it = items.get(rec.id);
    const note = rec.note ? ` Note: ${rec.note}.` : "";
    const answer = rec.ownerAnswer ? ` Owner answer: ${rec.ownerAnswer}.` : "";
    return `- ${rec.id} (${it?.type ?? "item"}, "${it?.summary ?? ""}"): ${rec.state}.${note}${answer}`;
  });
  for (const rec of undelivered.values()) {
    if (cfg.route) pending.set(rec.id, Math.max(rec.revision, pending.get(rec.id) ?? 0));
    else api.appendEntry(CUSTOM_TYPE, { event: "delivered", id: rec.id, revision: rec.revision });
  }
  return {
    message: {
      customType: RESOLUTION_TYPE,
      display: false,
      content: "ATDD attention update from the Coach (no reply needed):\n" + lines.join("\n"),
    },
  };
}

function registerCoach(api: Api, cfg: LaunchConfig, now: () => Date, options: StripOptions): StripHandle {
  const pollMs = options.pollMs ?? 5000;
  const setTimer = options.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = options.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const key = () => ensureKey(cfg.keyPath);
  let live: Ctx | undefined;
  let timer: unknown;
  const announced = new Set<string>();
  let previousQuarantine = -1;
  const legacyQuarantineCount = (at: Date) => cfg.route
    ? operational(foldAll(readSpool(cfg.spool, { ...cfg, route: undefined }, key()).events), at).size
    : 0;
  const warnQuarantine = (ctx: Ctx, at: Date) => {
    if (!cfg.route) return;
    const count = legacyQuarantineCount(at);
    if (count === previousQuarantine) return;
    previousQuarantine = count;
    if (count > 0) ctx.ui.notify(count + " legacy attention item(s) lack recipient routing and are quarantined. "
      + "Use the original unscoped coach or an owner-reviewed migration; no coach will receive them automatically.", "warning");
  };
  let items: string[] | undefined;

  /** Ingest verified spool records into the session, then return every verified record. */
  const ingest = (ctx: Ctx): SignedEvent[] => {
    const k = key();
    const before = sessionEvents(ctx, cfg, k);
    // In scoped mode the signed durable spool is authoritative across Pi sessions.
    // Hidden session entries are a cache, never a replacement for persisted events.
    if (cfg.route) {
      const events = readSpool(cfg.spool, cfg, k).events;
      const seen = new Set(before.map(keyOf));
      for (const ev of events) if (!seen.has(keyOf(ev))) {
        api.appendEntry(CUSTOM_TYPE, ev);
        seen.add(keyOf(ev));
      }
      return events;
    }
    const seen = new Set(before.map(keyOf));
    const offset = ours(ctx).reduce<number>(
      (max, d) => (isCursor(d) && d.event === "ingested" ? Math.max(max, d.offset) : max), 0);
    const spool = readSpool(cfg.spool, cfg, k, offset);
    const added: SignedEvent[] = [];
    for (const ev of spool.events) {
      const id = keyOf(ev);
      if (seen.has(id)) continue;
      seen.add(id);
      api.appendEntry(CUSTOM_TYPE, ev);
      added.push(ev);
    }
    if (spool.offset !== offset) api.appendEntry(CUSTOM_TYPE, { event: "ingested", offset: spool.offset } satisfies Cursor);
    return [...before, ...added];
  };

  /** The durable spool is authoritative: append it before session snapshots. */
  const commit = (rec: StateRecord): SignedEvent => {
    const ev = signEvent({ event: "state", rec }, key());
    withAttentionLock(cfg.spool, () => appendSpool(cfg.spool, ev));
    api.appendEntry(CUSTOM_TYPE, ev);
    return ev;
  };

  const render = (ctx: Ctx, all: Map<string, AttentionItem>, at: Date) => {
    const visible = [...operational(all, at).values()]
      .sort((a, b) => a.type.localeCompare(b.type) || a.createdAt.localeCompare(b.createdAt));
    items = visible.map(it => `${it.id} ${it.type}${it.issue ? " " + it.issue : ""} ${effectiveState(it, at)}`);
    if (visible.length === 0) return ctx.ui.setWidget(WIDGET_KEY, undefined);
    const lines = [`Attention · ${visible.length} live`, ...visible.map(it => {
      const state = effectiveState(it, at);
      const until = state === "snoozed" && it.snoozedUntil ? ` until ${it.snoozedUntil}` : "";
      return `• [${it.type}] ${it.id}${it.issue ? " " + it.issue : ""} ${state}${until} — ${it.summary}`;
    })];
    ctx.ui.setWidget(WIDGET_KEY, lines);
  };

  const refresh = (ctx: Ctx) => {
    if (!authorized(ctx, cfg, options)) return;
    const at = now();
    const data = ingest(ctx);
    warnQuarantine(ctx, at);
    if (cfg.route) {
      // Recheck expiry under the same writer lock as Coach actions. Two coach
      // processes can never append the same revision for one live item.
      const expired = fenced(ctx, options, () => withAttentionLock(cfg.spool, () => {
        if (!authorized(ctx, cfg, options)) return [] as SignedEvent[];
        const latest = readSpool(cfg.spool, cfg, key()).events;
        const due = expiryRecords(foldAll(latest), at, cfg);
        return due.map(rec => {
          const ev = signEvent({ event: "state", rec }, key());
          appendSpool(cfg.spool, ev);
          return ev;
        });
      }));
      for (const ev of expired) api.appendEntry(CUSTOM_TYPE, ev);
      render(ctx, foldAll(readSpool(cfg.spool, cfg, key()).events), at);
    } else {
      const expired = expiryRecords(foldAll(data), at, cfg).map(commit);
      render(ctx, foldAll([...data, ...expired]), at);
    }
  };

  const visible = (at: Date) => [...operational(foldAll(readSpool(cfg.spool, cfg, key()).events), at).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const actionable = (at: Date) => visible(at).filter(it => effectiveState(it, at) !== "snoozed");
  // A wake counts as announced only once a turn starts with it (before_agent_start). Until then it
  // is in flight and is re-sent after WAKE_WINDOW_MS, so a lost follow-up is not silent (PLT-118 review P2 A04).
  const wakeInFlight = new Map<string, number>();
  const WAKE_WINDOW_MS = 60_000;
  const alertNew = (ctx: Ctx) => {
    if (!authorized(ctx, cfg, options)) return;
    const nowMs = now().getTime();
    const unseen = actionable(now()).filter(it => !announced.has(it.id) &&
      nowMs - (wakeInFlight.get(it.id) ?? -Infinity) >= WAKE_WINDOW_MS);
    if (!unseen.length || !api.sendMessage) return;
    // One custom follow-up per batch. A busy Pi queues it until the run ends;
    // an idle Pi starts a turn. The item IDs, not the notice, are the record.
    try {
      api.sendMessage({
        customType: "pi-atdd-attention-alert", display: false,
        content: "SYSTEM: " + unseen.length + " new attention item(s) for this Coach: " +
          unseen.slice(0, 20).map(it => it.id).join(", ") +
          ". Inspect actionable items with attention_list and resolve within your grant.",
        details: { ids: unseen.map(it => it.id) },
      }, { triggerTurn: true, deliverAs: "followUp" });
      for (const item of unseen) wakeInFlight.set(item.id, nowMs);
    } catch (e) {
      // The signed item stays durable and the next poll retries its notice.
      ctx.ui.notify("ATDD attention wake deferred: " + String(e), "warning");
    }
  };

  const act = (ctx: unknown, id: string, action: Action): AttentionItem => {
    requireTrusted(ctx);
    const at = now();
    const ev = fenced(ctx, options, () => withAttentionLock(cfg.spool, () => {
      // Seat ownership and the compare-and-append are one critical section (PLT-118 review P1 A05/A06):
      // a stale coach cannot pass the check and then write after its seat was superseded.
      requireAuthorized(ctx, cfg, options);
      const all = foldAll(readSpool(cfg.spool, cfg, key()).events);
      const rec = transition(all.get(id), action, cfg, at);
      const signed = signEvent({ event: "state", rec }, key());
      appendSpool(cfg.spool, signed);
      return signed;
    }));
    api.appendEntry(CUSTOM_TYPE, ev);
    const all = foldAll(readSpool(cfg.spool, cfg, key()).events);
    render(ctx, all, at);
    return all.get(id) as AttentionItem;
  };

  const itemResult = (item: AttentionItem, action: string) =>
    textResult(`${item.id}: ${action} → ${item.state}`, { id: item.id, item });
  // Polling is armed whether or not the seat is authorized yet. Every poll action rechecks
  // authority, so a successor whose lease becomes current later is picked up by the next poll.
  const startPolling = (ctx: Ctx) => {
    live = ctx;
    if (timer === undefined) timer = setTimer(() => {
      if (live) try { refresh(live); alertNew(live); }
      catch (e) { live.ui.notify("ATDD attention refresh deferred: " + String(e), "warning"); }
    }, pollMs);
  };

  api.on("session_start", (_event, ctx) => {
    announced.clear();
    wakeInFlight.clear();
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    startPolling(ctx);
    if (!authorized(ctx, cfg, options)) return;
    refresh(ctx);
    alertNew(ctx);
  });
  api.on("session_tree", (_event, ctx) => {
    if (!authorized(ctx, cfg, options)) return;
    live = ctx;
    refresh(ctx);
  });
  api.on("before_agent_start", (_event, ctx) => {
    if (!authorized(ctx, cfg, options)) return undefined;
    // A fresh Pi session can be created before its lease is atomically rebound.
    // The successor's first authorized turn must activate polling even if
    // session_start observed the predecessor's now-stale lease.
    startPolling(ctx);
    // The turn that starts now carries any wake sent earlier: those items are announced.
    for (const id of wakeInFlight.keys()) announced.add(id);
    wakeInFlight.clear();
    refresh(ctx);
    const items = actionable(now());
    if (!items.length) return undefined;
    return { message: {
      customType: "pi-atdd-attention-pending", display: false,
      content: "ATDD Coach attention (" + items.length + " actionable):\n" +
        items.slice(0, 25).map(it => "- " + it.id + " [" + it.type + "] " +
          it.state + (it.issue ? " " + it.issue : "") + ": " + it.summary).join("\n") +
        (items.length > 25 ? "\nMore items exist; use attention_list." : "") +
        "\nUse attention_list for details; decisions above your grant require the owner.",
    } };
  });
  api.on("session_shutdown", () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    live = undefined;
  });

  api.registerTool({
    name: "attention_quarantine_status",
    label: "Legacy attention quarantine",
    description: "Count verified legacy records without a recipient; does not disclose another Coach's content.",
    parameters: schema({}, []),
    execute: async (_id: string, _params: Record<string, unknown>, _signal: unknown, _update: unknown, ctx: unknown) => {
      requireAuthorized(ctx, cfg, options);
      const count = legacyQuarantineCount(now());
      return textResult(`${count} quarantined legacy item(s); owner-reviewed migration required`, { count });
    },
  });
  api.registerTool({
    name: "attention_list",
    label: "List coach attention",
    description: "Read current task/coach-scoped attention, including snoozed items.",
    parameters: schema({}, []),
    execute: async (_id: string, _params: Record<string, unknown>, _signal: unknown, _update: unknown, ctx: unknown) => {
      requireAuthorized(ctx, cfg, options);
      const items = visible(now()).slice(0, 100);
      return textResult(listText(items, now()), { items });
    },
  });
  api.registerTool({
    name: "attention_ack",
    label: "Ack attention",
    description: "Acknowledge an open attention item (Coach).",
    parameters: schema({ id: { type: "string" } }, ["id"]),
    execute: async (_id: string, params: Record<string, unknown>, _signal: unknown, _update: unknown, ctx: unknown) =>
      itemResult(act(ctx, String(params.id), { kind: "ack" }), "ack"),
  });
  api.registerTool({
    name: "attention_snooze",
    label: "Snooze attention",
    description: "Snooze an attention item for a number of hours, capped at its TTL (Coach).",
    parameters: schema({ id: { type: "string" }, hours: { type: "number" } }, ["id", "hours"]),
    execute: async (_id: string, params: Record<string, unknown>, _signal: unknown, _update: unknown, ctx: unknown) =>
      itemResult(act(ctx, String(params.id), { kind: "snooze", hours: Number(params.hours) }), "snooze"),
  });
  api.registerTool({
    name: "attention_resolve",
    label: "Resolve attention",
    description: "Resolve an attention item. Use scope within_grant inside your grant. Above your grant, ask the owner first, then use scope owner_answer with ownerAnswer (Coach).",
    parameters: schema({
      id: { type: "string" },
      scope: { type: "string", enum: ["within_grant", "owner_answer"] },
      note: { type: "string" },
      ownerAnswer: { type: "string" },
    }, ["id", "scope", "note"]),
    execute: async (_id: string, params: Record<string, unknown>, _signal: unknown, _update: unknown, ctx: unknown) =>
      itemResult(act(ctx, String(params.id), {
        kind: "resolve", scope: params.scope, note: params.note, ownerAnswer: params.ownerAnswer,
      }), "resolve"),
  });

  api.registerCommand("attention", {
    description: "Attention strip: /attention [ack|snooze <id> <hours>|resolve <id> <note>|cancel <id> <note>]",
    handler: async (args: string, ctx: Ctx) => {
      if (!authorized(ctx, cfg, options)) {
        ctx.ui.notify("ATDD attention requires a trusted project and current coach seat", "warning");
        return;
      }
      const [verb, id, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      try {
        if (!verb) return refresh(ctx);
        const target = String(id ?? "");
        const text = rest.join(" ");
        const item = verb === "ack" ? act(ctx, target, { kind: "ack" })
          : verb === "snooze" ? act(ctx, target, { kind: "snooze", hours: Number(rest[0]) })
          : verb === "resolve" ? act(ctx, target, { kind: "resolve", scope: "within_grant", note: text })
          : verb === "cancel" ? act(ctx, target, { kind: "cancel", note: text })
          : undefined;
        if (!item) throw new Error("usage: /attention [ack|snooze <id> <hours>|resolve <id> <note>|cancel <id> <note>]");
        ctx.ui.notify(`${item.id} → ${item.state}`, "info");
      } catch (e) {
        ctx.ui.notify(String((e as Error).message ?? e), "error");
      }
    },
  });
  return { liveItems: () => items };
}
