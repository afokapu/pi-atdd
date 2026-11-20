/**
 * PLT-102 — pure decision, redaction and handoff-text functions for automatic context handoff.
 * No Pi runtime imports here; the Pi adapter (src/pi-activation.ts) performs the I/O.
 */

export type HandoffThresholds = { notifyAt: number; handoffAt: number };
export type HandoffState = { notified: boolean; handoffRequested: boolean };
export type HandoffAction = "none" | "notify" | "handoff" | "limit";
export type HandoffDecision = { action: HandoffAction; state: HandoffState };

export const DEFAULT_THRESHOLDS: HandoffThresholds = { notifyAt: 80, handoffAt: 85 };
export const DEFAULT_MAX_HOPS = 5;
export const INITIAL_HANDOFF_STATE: HandoffState = { notified: false, handoffRequested: false };
export const RECORD_HEADER = "# ATDD context handoff (shared.handoff)";

const MAX_HANDOFF_CHARS = 6_000;
const MAX_TASK_CHARS = 1_200;

function percentSetting(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) throw new Error(name + " must be a percentage 0-100, got " + JSON.stringify(raw));
  return Number(raw.trim());
}

/** Thresholds are percentages. Defaults 80 (notify once) and 85 (request handoff). */
export function resolveThresholds(env: Record<string, string | undefined>): HandoffThresholds {
  const notifyAt = percentSetting("PI_ATDD_HANDOFF_NOTIFY_AT", env.PI_ATDD_HANDOFF_NOTIFY_AT, DEFAULT_THRESHOLDS.notifyAt);
  const handoffAt = percentSetting("PI_ATDD_HANDOFF_AT", env.PI_ATDD_HANDOFF_AT, DEFAULT_THRESHOLDS.handoffAt);
  if (notifyAt <= 0 || handoffAt > 100 || notifyAt > handoffAt)
    throw new Error("handoff thresholds must satisfy 0 < notify <= handoff <= 100");
  return { notifyAt, handoffAt };
}

/** Maximum handoffs in one chain. Each successor must stop at this bound, so a chain cannot loop forever. */
export function resolveMaxHops(env: Record<string, string | undefined>): number {
  const raw = env.PI_ATDD_HANDOFF_MAX_HOPS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_HOPS;
  const value = Number(raw.trim());
  if (!/^\d+$/.test(raw.trim()) || value < 1 || value > 50)
    throw new Error("PI_ATDD_HANDOFF_MAX_HOPS must be an integer 1-50, got " + JSON.stringify(raw));
  return value;
}

export const DEFAULT_COMPACTION_RESERVE = 16_384;

/**
 * Pi resolves compaction.reserveTokens per field: the active model's entry in
 * compaction.modelOverrides (keyed "provider/id"), then the global value, then the default.
 * Invalid values are ignored here (Pi itself rejects them when it compacts).
 */
export function resolveCompactionReserve(settings: unknown, model: { provider: string; id: string } | undefined): number {
  const compaction = (settings as { compaction?: { reserveTokens?: unknown;
    modelOverrides?: Record<string, { reserveTokens?: unknown } | undefined> } } | undefined)?.compaction;
  const override = model ? compaction?.modelOverrides?.[model.provider + "/" + model.id]?.reserveTokens : undefined;
  const valid = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  return valid(override) ?? valid(compaction?.reserveTokens) ?? DEFAULT_COMPACTION_RESERVE;
}

/**
 * Pi starts its own compaction when contextTokens > window - reserveTokens. A handoff
 * that waits for a higher percentage than that never fires, so the handoff threshold is
 * capped at the compaction line and notify is kept at or below handoff.
 */
export function clampToCompaction(t: HandoffThresholds, contextWindow: number, reserveTokens: number): HandoffThresholds {
  if (!(contextWindow > 0)) return t;
  const compactionPercent = (100 * (contextWindow - reserveTokens)) / contextWindow;
  const handoffAt = Math.max(1, Math.min(t.handoffAt, compactionPercent));
  return { notifyAt: Math.min(t.notifyAt, handoffAt), handoffAt };
}

/**
 * Decide the action for one observation. `percent` comes from ctx.getContextUsage();
 * null (unknown usage) never triggers anything. Each action fires at most once per session.
 * When `chainFull` is true (this session already sits at the hop limit), crossing the
 * handoff threshold reports a limit instead of requesting another handoff.
 */
export function decideContextAction(percent: number | null, thresholds: HandoffThresholds,
    state: HandoffState, chainFull = false): HandoffDecision {
  if (percent === null || !Number.isFinite(percent) || state.handoffRequested) return { action: "none", state };
  if (percent >= thresholds.handoffAt)
    return { action: chainFull ? "limit" : "handoff", state: { notified: true, handoffRequested: true } };
  if (percent >= thresholds.notifyAt && !state.notified)
    return { action: "notify", state: { ...state, notified: true } };
  return { action: "none", state };
}

/**
 * Settle decision. The request is latched at turn_end with the usage that crossed the
 * threshold and is not re-read here: Pi may compact before the run settles and lower the
 * usage, and that must not cancel the handoff (PLT-102 review P1). Only an aborted run,
 * where the user pressed Escape, drops it.
 */
export function decideSettle(aborted: boolean): "handoff" | "drop" {
  return aborted ? "drop" : "handoff";
}

/**
 * Kickoff for the successor session. It names the issue so that the successor's
 * first user message keeps the id for any later handoff.
 */
export function kickoffText(issue: string | undefined): string {
  return "Continue " + (issue ? issue + " " : "") +
    "from the ATDD context handoff above. Re-verify any claimed completion before relying on it.";
}

/** First PLT-style tracker identifier in the task text, if any. */
export function extractIssueId(task: string): string | undefined {
  return /\b[A-Z][A-Z0-9]{1,9}-\d+\b/.exec(task)?.[0];
}

/**
 * Hop index carried by a handoff record: the record written by a session at hop h says
 * "Hop: h+1", and the successor that receives it starts at that index. Text that does not
 * carry the record header is not a record, so it counts as hop 0.
 */
export function parseHop(text: string): number {
  if (!text.includes(RECORD_HEADER)) return 0;
  const match = /^Hop: (\d+)/m.exec(text);
  return match ? Number(match[1]) : 0;
}

/**
 * Best-effort, list-based redaction of the user's task before any record is written or sent. It covers
 * the listed credential labels and provider token shapes only; it is not general secret detection.
 * Over-redaction is accepted: a long mixed letter-and-digit run, such as a commit SHA in the
 * task, is redacted too. The workspace and record paths are controlled values and are not redacted.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/((?:password|passwd|pwd|passphrase|secret|token|credentials?|auth(?:orization)?|api[_-]?key|apikey|access[_-]?key|private[ _-]?key|client[_-]?secret)\s*[:=]\s*)\S+/gi, "$1[REDACTED]"],
  [/(\bAuthorization[:=]?\s+Basic\s+)\S+/gi, "$1[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/\b(?:sk|pk)[-_][A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{8,}/g, "[REDACTED]"],
  [/\bxox[abp]-[A-Za-z0-9-]{8,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{12,}/g, "[REDACTED]"],
  [/(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Za-z])[A-Za-z0-9+/]{32,}={0,2}/g, "[REDACTED]"],
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : text.slice(0, max) + " [clipped]";

export type HandoffInput = {
  task: string;
  cwd: string;
  /** Usage at the turn that crossed the threshold (latched; not re-read at settle). */
  percent: number;
  contextWindow: number;
  revision?: string;
  handoffPath?: string;
  /** Hop number this record opens (1 for the first successor). */
  hop?: number;
};

/**
 * Handoff record in the `shared.handoff` shape: issue, workspace, task, done, next,
 * open items and grant, and how to resume. The predecessor's own output is never copied
 * (it is unverified and may contain secrets); the task and workspace are redacted and bounded.
 */
export function buildHandoff(input: HandoffInput): string {
  const issue = extractIssueId(input.task) ?? "unknown (no tracker id in task)";
  const hop = input.hop ?? 1;
  const lines = [
    RECORD_HEADER,
    "Hop: " + hop + " (this record opens hop " + hop + " of a handoff chain)",
    "Issue: " + issue,
    "Workspace: " + input.cwd,
    "Revision: " + (input.revision ?? "UNKNOWN"),
    "Context at handoff: " + input.percent.toFixed(1) + "% of " + input.contextWindow +
      " tokens (measured at the turn that crossed the threshold)",
    "Task (user's words, best-effort redaction of listed credential labels and token shapes): " + clip(redact(input.task.trim()), MAX_TASK_CHARS),
    "Done / last state: not recorded. The predecessor's own output is never copied into a handoff; re-derive the state from the repository and the task.",
    "Next: continue from the task above; verify the repository state before relying on any claim of completion.",
    "Open items: UNKNOWN. The predecessor did not record them; reconstruct from the task and repository.",
    "Grant: as stated in the original brief; a handoff does not widen it or approve merges, installs or spending.",
    "How to resume: start from this record, run the workspace checks, and do not treat this summary as evidence of completion.",
    input.handoffPath ? "Record file: " + input.handoffPath : "",
    "ATDD: unresolved applicability stays UNKNOWN; this record is not a compliance verdict.",
  ].filter(Boolean);
  return clip(lines.join("\n"), MAX_HANDOFF_CHARS);
}
