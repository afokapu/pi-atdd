/** Minimal, local-only activation observations. No prompts, source, or raw paths are persisted. */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ActivationOutcome = "matched" | "unknown" | "incomplete" | "excluded" | "noop" | "error";
export type ActivationPoint = "task_start" | "pre_edit" | "post_tool";
export type ActivationEvent = {
  point: ActivationPoint; outcome: ActivationOutcome;
  operation?: "task" | "edit" | "create" | "review";
  pathCategory?: "source" | "test" | "vendor" | "other" | "none";
  reasonCode?: string; ruleIds?: readonly string[]; evidenceIds?: readonly string[];
  delivered?: number; deduplicated?: number; omitted?: number; durationMs?: number;
  catalogDigest?: string; sessionId?: string;
};
export type TelemetryCounts = Record<ActivationOutcome, number>;
const SCHEMA = "pi-atdd/activation/v1";
const LIMIT = 1_048_576; // 1 MiB current and one rotated file per repository
const OUTCOMES: ActivationOutcome[] = ["matched", "unknown", "incomplete", "excluded", "noop", "error"];
const POINTS: ActivationPoint[] = ["task_start", "pre_edit", "post_tool"];
// Only closed, bounded IDs may cross the telemetry boundary. Evidence proofs,
// prompts, code snippets and full paths must never become log fields.
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

/** Classify an observed path without persisting the path itself.
 * Path categories support denominators but cannot establish correctness.
 */
export function activationPathCategory(file?: string): NonNullable<ActivationEvent["pathCategory"]> {
  if (!file) return "none";
  const path = file.replaceAll("\\", "/");
  if (/(^|\/)(?:vendor|dist|build|node_modules|\.cache-sources)(\/|$)/.test(path)) return "vendor";
  if (/(?:\.test|\.spec)\.[cm]?[jt]sx?$|(^|\/)(?:tests|test|e2e)(\/|$)/i.test(path)) return "test";
  if (/\.[cm]?[jt]sx?$/i.test(path)) return "source";
  return "other";
}
type TelemetryLocation = {root?: string; disabled?: boolean};
/** An explicit test setting is local to the call. Ordinary Pi use still
 * honors the user's PI_ATDD_TELEMETRY environment switch.
 */
function isDisabled(options: TelemetryLocation): boolean {
  return options.disabled ?? (process.env.PI_ATDD_TELEMETRY === "off");
}
/** An explicitly supplied sink remains scoped to the caller; the Pi host uses
 * the original user-state default. Tests no longer need to mutate process.env.
 */
function root(override?: string): string {
  return override || process.env.PI_ATDD_TELEMETRY_DIR ||
    join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "pi-atdd", "activation");
}
/** Hash the repository path so two local checkouts cannot share a log file.
 * The root override is controlled by the Pi extension caller, not by task text.
 */
export function activationLogPath(cwd: string, options: TelemetryLocation = {}): string {
  const repoId = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 20);
  return join(root(options.root), repoId + ".jsonl");
}
// Even well-formed IDs are capped, sorted and deduplicated to prevent a tool
// from turning telemetry into an unbounded evidence-exfiltration channel.
function ids(value: readonly string[] | undefined): string[] {
  return [...new Set((value ?? []).filter(x => ID.test(x)))].sort().slice(0, 64);
}
function count(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
}
/** Persist sanitized counters only. A write failure is an observability gap,
 * not grounds to approve, waive, block or falsely claim code compliance.
 */
export function appendActivation(cwd: string, event: ActivationEvent,
  options: TelemetryLocation & {maxBytes?: number} = {}):
  {ok: true; path: string} | {ok: false; reason: string} {
  if (isDisabled(options)) return {ok: true, path: "disabled"};
  try {
    const path = activationLogPath(cwd, options);
    // Build a closed schema: ignore unknown event keys even when supplied by
    // an untrusted tool result. Never stringify the original event object.
    const record = {
      schema: SCHEMA, at: new Date().toISOString(),
      repoId: createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 20),
      sessionId: typeof event.sessionId === "string" && /^[a-zA-Z0-9-]{1,50}$/.test(event.sessionId)
        ? event.sessionId : "unknown",
      point: event.point, outcome: event.outcome, operation: event.operation ?? "task",
      pathCategory: event.pathCategory ?? "none",
      reasonCode: event.reasonCode && ID.test(event.reasonCode) ? event.reasonCode : "none",
      ruleIds: ids(event.ruleIds), evidenceIds: ids(event.evidenceIds),
      delivered: count(event.delivered), deduplicated: count(event.deduplicated),
      omitted: count(event.omitted),
      durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs! * 10) / 10) : 0,
      catalogDigest: event.catalogDigest && /^[a-f0-9]{12,64}$/.test(event.catalogDigest)
        ? event.catalogDigest.slice(0, 12) : "unknown",
    };
    const line = JSON.stringify(record) + "\n";
    const limit = options.maxBytes ?? LIMIT;
    // Keep one bounded current file and one rotated predecessor. Private
    // user-state permissions remain the default for production operation.
    mkdirSync(root(options.root), {recursive: true, mode: 0o700});
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > limit)
      renameSync(path, path + ".1");
    appendFileSync(path, line, {encoding: "utf8", mode: 0o600});
    return {ok: true, path};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return {ok: false, reason: code && ID.test(code) ? code : "write_failed"};
  }
}
export function emptyCounts(): TelemetryCounts {
  return {matched: 0, unknown: 0, incomplete: 0, excluded: 0, noop: 0, error: 0};
}
export type TelemetrySummary = {
  groups: Record<ActivationPoint, TelemetryCounts>;
  malformed: number; unreadable: number;
  total: number;
};
/** Ratios describe trigger frequency, not precision, recall, compliance, or applicability truth. */
/** Malformed, oversized or unreadable logs are counted as gaps rather than
 * being accepted as clean zero-event records. A summary is not a policy verdict.
 */
export function activationSummary(cwd: string, options: TelemetryLocation = {}): TelemetrySummary {
  const groups = {task_start: emptyCounts(), pre_edit: emptyCounts(), post_tool: emptyCounts()};
  let malformed = 0, unreadable = 0, total = 0;
  if (isDisabled(options)) return {groups, malformed, unreadable, total};
  const path = activationLogPath(cwd, options);
  for (const file of [path + ".1", path]) {
    if (!existsSync(file)) continue;
    try {
      if (statSync(file).size > 2 * LIMIT) {unreadable++; continue;}
      for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
        try {
          const e: unknown = JSON.parse(line);
          if (!e || typeof e !== "object") {malformed++;continue;}
          const v = e as {schema?:string;point?:string;outcome?:string};
          if (v.schema !== SCHEMA || !POINTS.includes(v.point as ActivationPoint) ||
              !OUTCOMES.includes(v.outcome as ActivationOutcome)) {malformed++;continue;}
          groups[v.point as ActivationPoint][v.outcome as ActivationOutcome]++;
          total++;
        } catch {malformed++; }
      }
    } catch { unreadable++; }
  }
  return {groups, malformed, unreadable, total};
}
/** Present the eligible-attempt denominator beside matched counts; matches
 * alone cannot measure false activations, recall or agent implementation quality.
 */
export function formatActivationSummary(cwd: string, options: TelemetryLocation = {}): string {
  if (isDisabled(options)) return "ATDD local activation telemetry disabled (PI_ATDD_TELEMETRY=off)";
  const s = activationSummary(cwd, options);
  const lines = ["ATDD local activation log: " + activationLogPath(cwd, options),
    "Recent bounded events only; rate = matched / eligible observed attempts. Not correctness or recall."];
  for (const point of POINTS) {
    const x = s.groups[point];
    const eligible = x.matched + x.unknown + x.incomplete + x.error;
    lines.push(point + ": " + x.matched + "/" + eligible + " eligible (" +
      (eligible ? Math.round(1000 * x.matched / eligible) / 10 + "%" : "n/a") +
      "); unknown=" + x.unknown + ", incomplete=" + x.incomplete +
      ", error=" + x.error + ", excluded=" + x.excluded + ", noop=" + x.noop);
  }
  lines.push("records=" + s.total + ", malformed=" + s.malformed + ", unreadable=" + s.unreadable);
  return lines.join("\n");
}
