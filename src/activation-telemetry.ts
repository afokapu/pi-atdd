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
/** Accept only a bounded session identity; never copy a prompt or free-form label. */
function safeSessionId(value: string | undefined): string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,50}$/.test(value) ? value : "unknown";
}
/** Keep reason and catalog identifiers closed to prevent raw evidence leakage. */
function safeReasonCode(value: string | undefined): string {
  return value && ID.test(value) ? value : "none";
}
function safeCatalogDigest(value: string | undefined): string {
  return value && /^[a-f0-9]{12,64}$/.test(value) ? value.slice(0, 12) : "unknown";
}
function safeDurationMs(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value! * 10) / 10) : 0;
}
/** Construct only whitelisted fields, never spread the untrusted event object. */
function sanitizedRecord(cwd: string, event: ActivationEvent) {
  return {
    schema: SCHEMA, at: new Date().toISOString(),
    repoId: createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 20),
    sessionId: safeSessionId(event.sessionId),
    point: event.point, outcome: event.outcome, operation: event.operation ?? "task",
    pathCategory: event.pathCategory ?? "none",
    reasonCode: safeReasonCode(event.reasonCode),
    ruleIds: ids(event.ruleIds), evidenceIds: ids(event.evidenceIds),
    delivered: count(event.delivered), deduplicated: count(event.deduplicated),
    omitted: count(event.omitted), durationMs: safeDurationMs(event.durationMs),
    catalogDigest: safeCatalogDigest(event.catalogDigest),
  };
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
    const record = sanitizedRecord(cwd,event);
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
type PerFileCounts = {total: number; malformed: number; unreadable: number};
/** A malformed event is an observation gap, not a successful empty record. */
function countLine(line: string, groups: TelemetrySummary["groups"]): boolean {
  try {
    const raw: unknown = JSON.parse(line);
    if (!raw || typeof raw !== "object") return false;
    const value = raw as {schema?: string; point?: string; outcome?: string};
    if (value.schema !== SCHEMA || !POINTS.includes(value.point as ActivationPoint) ||
        !OUTCOMES.includes(value.outcome as ActivationOutcome)) return false;
    groups[value.point as ActivationPoint][value.outcome as ActivationOutcome]++;
    return true;
  } catch { return false; }
}
/** Each file is bounded; failed reads are counted, never silently ignored. */
function countFile(file: string, groups: TelemetrySummary["groups"]): PerFileCounts {
  if (!existsSync(file)) return {total: 0, malformed: 0, unreadable: 0};
  try {
    if (statSync(file).size > 2 * LIMIT) return {total: 0, malformed: 0, unreadable: 1};
    let total=0, malformed=0;
    for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      if (countLine(line, groups)) total++;
      else malformed++;
    }
    return {total,malformed,unreadable:0};
  } catch { return {total:0,malformed:0,unreadable:1}; }
}
/** Summaries retain both the current and rotated windows, never an all-time
 * compliance denominator. Missing or invalid records remain visible as gaps.
 */
export function activationSummary(cwd: string, options: TelemetryLocation = {}): TelemetrySummary {
  const groups = {task_start: emptyCounts(), pre_edit: emptyCounts(), post_tool: emptyCounts()};
  if (isDisabled(options)) return {groups, malformed:0, unreadable:0, total:0};
  const path = activationLogPath(cwd,options);
  const older = countFile(path+".1", groups);
  const current = countFile(path, groups);
  return {groups, malformed:older.malformed+current.malformed,
    unreadable:older.unreadable+current.unreadable,total:older.total+current.total};
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
