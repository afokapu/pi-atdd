/**
 * PLT-101 Pi wiring for the Attention Strip. Domain rules live in attention.ts.
 * Strip is inert unless PI_ATDD_ATTENTION_ROLE is set. Trust gate matches pi-activation.ts.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ATTENTION_TYPES, CUSTOM_TYPE, RESOLUTION_TYPE, WIDGET_KEY, acceptableRaise, appendSpool, effectiveState,
  fold, isLive, newItem, readLaunchConfig, readSpool, transition,
  type Action, type AttentionEvent, type AttentionItem, type Cursor, type LaunchConfig, type StateRecord,
} from "./attention.ts";

export type StripOptions = {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  pollMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

/** The subset of Pi's extension context this module uses. */
type Ctx = {
  isProjectTrusted: () => boolean;
  sessionManager: { getBranch: () => unknown[] };
  ui: { notify: (message: string, level?: string) => void; setWidget: (key: string, lines: string[] | undefined) => void };
};
type Data = AttentionEvent | Cursor;

const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });
const textResult = (message: string, details: Record<string, unknown>) => ({ content: [{ type: "text", text: message }], details });

const isEvent = (d: Data): d is AttentionEvent => d.event === "raised" || d.event === "state";

/** Hidden session entries that belong to this module, in branch order. */
function branchData(ctx: Ctx): Data[] {
  return (ctx.sessionManager.getBranch() as Array<{ type?: string; customType?: string; data?: unknown }>)
    .filter(e => e?.type === "custom" && e.customType === CUSTOM_TYPE)
    .map(e => e.data as Data);
}

export function registerAttentionStrip(pi: ExtensionAPI, options: StripOptions = {}): void {
  const cfg = readLaunchConfig(options.env ?? process.env);
  if (!cfg) return;
  const now = options.now ?? (() => new Date());
  const api = asApi(pi);
  if (cfg.role === "worker") registerWorker(api, cfg, now);
  else registerCoach(api, cfg, now, options);
}

type Api = ReturnType<typeof asApi>;

function registerWorker(api: Api, cfg: LaunchConfig, now: () => Date): void {
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
    execute: async (_id: string, params: Record<string, unknown>) => {
      const item = newItem(params, cfg, now());
      appendSpool(cfg.spool, { event: "raised", item });
      return textResult(`Raised ${item.id} (${item.type}). The Coach sees it on its next refresh.`, { id: item.id, item });
    },
  });
  api.registerTool({
    name: "attention_status",
    label: "Attention status",
    description: "Show the current state of attention items this worker raised.",
    parameters: schema({ id: { type: "string" } }, []),
    execute: async (_id: string, params: Record<string, unknown>) => {
      const mine = [...fold(readSpool(cfg.spool).events).values()].filter(it => it.from === cfg.identity);
      if (typeof params.id === "string") {
        const item = mine.find(it => it.id === params.id);
        return textResult(item ? `${item.id}: ${item.state}` : "not found", { item });
      }
      return textResult(`${mine.length} item(s)`, { items: mine });
    },
  });
  api.on("before_agent_start", (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    return deliverResolutions(api, ctx, cfg);
  });
}

/** Worker sees each Coach state change for its items once, on its next turn. */
function deliverResolutions(api: Api, ctx: Ctx, cfg: LaunchConfig) {
  const delivered = new Map<string, number>();
  for (const d of branchData(ctx)) {
    if (d.event === "delivered") delivered.set(d.id, Math.max(delivered.get(d.id) ?? 0, d.revision));
  }
  const events = readSpool(cfg.spool).events;
  const items = fold(events);
  const latest = new Map<string, StateRecord>();
  for (const ev of events) {
    if (ev.event !== "state" || ev.rec.from !== cfg.identity) continue;
    if (ev.rec.revision > (delivered.get(ev.rec.id) ?? 1)) latest.set(ev.rec.id, ev.rec);
  }
  if (latest.size === 0) return undefined;
  const lines = [...latest.values()].map(rec => {
    const it = items.get(rec.id);
    const note = rec.note ? ` Note: ${rec.note}.` : "";
    const answer = rec.ownerAnswer ? ` Owner answer: ${rec.ownerAnswer}.` : "";
    return `- ${rec.id} (${it?.type ?? "item"}, "${it?.summary ?? ""}"): ${rec.state}.${note}${answer}`;
  });
  for (const rec of latest.values()) api.appendEntry(CUSTOM_TYPE, { event: "delivered", id: rec.id, revision: rec.revision });
  return {
    message: {
      customType: RESOLUTION_TYPE,
      display: false,
      content: "ATDD attention update from the Coach (no reply needed):\n" + lines.join("\n"),
    },
  };
}

function registerCoach(api: Api, cfg: LaunchConfig, now: () => Date, options: StripOptions): void {
  const pollMs = options.pollMs ?? 5000;
  const setTimer = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = options.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  let live: Ctx | undefined;
  let timer: unknown;

  /** Ingest new spool items into hidden entries, then return all branch data. */
  const ingest = (ctx: Ctx): Data[] => {
    const before = branchData(ctx);
    const known = new Set(before.flatMap(d => (d.event === "raised" ? [d.item.id] : [])));
    const offset = before.reduce((max, d) => (d.event === "ingested" ? Math.max(max, d.offset) : max), 0);
    const spool = readSpool(cfg.spool, offset);
    const added: Data[] = [];
    for (const ev of spool.events) {
      if (ev.event !== "raised" || known.has(ev.item.id) || !acceptableRaise(ev.item, cfg)) continue;
      known.add(ev.item.id);
      api.appendEntry(CUSTOM_TYPE, ev);
      added.push(ev);
    }
    if (spool.offset !== offset) {
      const cursor: Cursor = { event: "ingested", offset: spool.offset };
      api.appendEntry(CUSTOM_TYPE, cursor);
      added.push(cursor);
    }
    return [...before, ...added];
  };

  const render = (ctx: Ctx, items: Map<string, AttentionItem>, at: Date) => {
    const visible = [...items.values()].filter(it => isLive(it, at))
      .sort((a, b) => a.type.localeCompare(b.type) || a.createdAt.localeCompare(b.createdAt));
    if (visible.length === 0) return ctx.ui.setWidget(WIDGET_KEY, undefined);
    const lines = [`Attention · ${visible.length} live`, ...visible.map(it => {
      const state = effectiveState(it, at);
      const until = state === "snoozed" && it.snoozedUntil ? ` until ${it.snoozedUntil}` : "";
      return `• [${it.type}] ${it.id}${it.issue ? " " + it.issue : ""} ${state}${until} — ${it.summary}`;
    })];
    ctx.ui.setWidget(WIDGET_KEY, lines);
  };

  const refresh = (ctx: Ctx) => {
    const at = now();
    render(ctx, fold(ingest(ctx)), at);
  };

  /** Coach action: append the hidden entry first, then mirror to the spool for the worker. */
  const act = (ctx: Ctx, id: string, action: Action) => {
    const at = now();
    const data = ingest(ctx);
    const rec = transition(fold(data.filter(isEvent)).get(id), action, cfg, at);
    const ev: AttentionEvent = { event: "state", rec };
    api.appendEntry(CUSTOM_TYPE, ev);
    appendSpool(cfg.spool, ev);
    const after = fold([...data.filter(isEvent), ev]);
    render(ctx, after, at);
    return after.get(id) as AttentionItem;
  };
  const need = (ctx: Ctx | undefined): Ctx => {
    const c = ctx ?? live;
    if (!c) throw new Error("no live Coach session");
    return c;
  };
  const itemResult = (item: AttentionItem, action: string) =>
    textResult(`${item.id}: ${action} → ${item.state}`, { id: item.id, item });

  api.on("session_start", (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    live = ctx;
    refresh(ctx);
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(() => { if (live) refresh(live); }, pollMs);
  });
  api.on("session_tree", (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    live = ctx;
    refresh(ctx);
  });
  api.on("before_agent_start", (_event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    refresh(ctx);
  });
  api.on("session_shutdown", () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    live = undefined;
  });

  api.registerTool({
    name: "attention_ack",
    label: "Ack attention",
    description: "Acknowledge an open attention item (Coach).",
    parameters: schema({ id: { type: "string" } }, ["id"]),
    execute: async (_id: string, params: Record<string, unknown>, _s: unknown, _u: unknown, ctx?: Ctx) =>
      itemResult(act(need(ctx), String(params.id), { kind: "ack" }), "ack"),
  });
  api.registerTool({
    name: "attention_snooze",
    label: "Snooze attention",
    description: "Snooze an attention item for a number of hours, capped at its TTL (Coach).",
    parameters: schema({ id: { type: "string" }, hours: { type: "number" } }, ["id", "hours"]),
    execute: async (_id: string, params: Record<string, unknown>, _s: unknown, _u: unknown, ctx?: Ctx) =>
      itemResult(act(need(ctx), String(params.id), { kind: "snooze", hours: Number(params.hours) }), "snooze"),
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
    execute: async (_id: string, params: Record<string, unknown>, _s: unknown, _u: unknown, ctx?: Ctx) =>
      itemResult(act(need(ctx), String(params.id), {
        kind: "resolve", scope: params.scope, note: params.note, ownerAnswer: params.ownerAnswer,
      }), "resolve"),
  });

  api.registerCommand("attention", {
    description: "Attention strip: /attention [ack|snooze <h>|resolve|cancel] <id> [text]",
    handler: async (args: string, ctx: Ctx) => {
      const [verb, id, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      try {
        if (!verb) return refresh(ctx);
        const target = String(id ?? "");
        const joined = rest.join(" ");
        const item = verb === "ack" ? act(ctx, target, { kind: "ack" })
          : verb === "snooze" ? act(ctx, target, { kind: "snooze", hours: Number(rest[0]) })
          : verb === "resolve" ? act(ctx, target, { kind: "resolve", scope: "within_grant", note: joined })
          : verb === "cancel" ? act(ctx, target, { kind: "cancel", note: joined })
          : undefined;
        if (!item) throw new Error("usage: /attention [ack|snooze <h>|resolve|cancel] <id> [text]");
        ctx.ui.notify(`${item.id} → ${item.state}`, "info");
      } catch (e) {
        ctx.ui.notify(String((e as Error).message ?? e), "error");
      }
    },
  });
}

function asApi(pi: ExtensionAPI) {
  return pi as unknown as {
    on: (name: string, fn: (event: unknown, ctx: Ctx) => unknown) => void;
    registerTool: (def: unknown) => void;
    registerCommand: (name: string, def: unknown) => void;
    appendEntry: (customType: string, data: unknown) => void;
  };
}
