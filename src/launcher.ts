/**
 * ATD-36 (scope widened 2026-11-22): the canonical launch for pi-atdd governed agents.
 * `atdd launch` sets the profile, mode, role, identity and attention route, creates a fresh execution
 * id shared by the route and the seat, bootstraps the standalone generation-1 seat with bootstrapSeat(),
 * and starts pi. It refuses when either half (the attention route or the execution seat) is incomplete.
 * Rule for every profile: never bare `pi`, never a hand-written env line.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { bootstrapSeat, executionConfigFromEnv } from "./execution-seat.ts";

export type LaunchRole = "coach" | "worker" | "reviewer";
const ROLES: readonly string[] = ["coach", "worker", "reviewer"];

export type LaunchInput = {
  role?: string; label?: string; cwd?: string; profile?: string; agentDir?: string;
  project?: string; coach?: string; task?: string;
  model?: string; tier?: string; via?: string; session?: string;
  piArgs?: string[];
};

/** Injected for tests: fresh ids and the model-tier resolver. Defaults are random and real. */
export type LaunchDeps = {
  id: () => string;
  token: () => string;
  resolveTier: (tier: string, via?: string) => string[];
  readSessionId: (file: string) => string;
};

export type LaunchPlan = {
  role: LaunchRole; cwd: string; piArgs: string[]; env: Record<string, string>;
  sessionId: string; executionId: string; seatAddress: string; modelId: string;
};

/** Refusal names every missing input, so the owner can fix the launch in one step. */
export class LaunchRefused extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super("launch refused: " + missing.join("; "));
    this.missing = missing;
  }
}

export const defaultDeps: LaunchDeps = {
  id: () => randomUUID(),
  token: () => randomBytes(24).toString("hex"),
  resolveTier: (tier, via) => execFileSync("model-tier", [tier, ...(via ? ["--via", via] : [])],
    { encoding: "utf8", timeout: 15000 }).trim().split(/\s+/),
  readSessionId: file => {
    const header = JSON.parse(readFileSync(file, "utf8").split("\n")[0] ?? "") as { type?: unknown; id?: unknown };
    if (header.type !== "session" || typeof header.id !== "string") throw new Error("not a Pi session file: " + file);
    return header.id;
  },
};

const text = (v?: string) => v?.trim() ? v.trim() : undefined;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const valueOf = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

/** The model pi arguments for a tier, or for an explicit provider/id. */
function modelArgs(input: LaunchInput, role: string, deps: LaunchDeps, seat: string[]): string[] {
  if (text(input.model)) {
    const m = text(input.model)!, cut = m.indexOf("/");
    if (cut <= 0 || cut === m.length - 1) { seat.push("--model provider/model-id"); return []; }
    return ["--provider", m.slice(0, cut), "--model", m.slice(cut + 1)];
  }
  const tier = text(input.tier) ?? (role === "coach" ? "medium" : "low");
  try {
    const args = deps.resolveTier(tier, text(input.via));
    if (!valueOf(args, "--provider") || !valueOf(args, "--model")) seat.push("model tier " + tier + " (no provider/model)");
    return args;
  } catch (e) {
    seat.push("model tier " + tier + " (" + (e instanceof Error ? e.message : String(e)) + ")");
    return [];
  }
}

/** Validates both halves and builds the env and pi arguments. Writes nothing. */
export function planLaunch(input: LaunchInput, deps: LaunchDeps = defaultDeps, parent: NodeJS.ProcessEnv = {}): LaunchPlan {
  const route: string[] = [], seat: string[] = [];
  const role = text(input.role);
  if (!role || !ROLES.includes(role)) route.push("--role coach|worker|reviewer");
  const label = text(input.label); if (!label) route.push("--label");
  const profile = text(input.profile); if (!profile) route.push("--profile");
  const project = text(input.project); if (!project) route.push("--project");
  const coach = text(input.coach); if (!coach) route.push("--coach");
  const task = text(input.task);
  if ((role === "worker" || role === "reviewer") && !task) route.push("--task (required for " + role + ")");
  const agentDir = text(input.agentDir);
  if (!agentDir || !isAbsolute(agentDir)) seat.push("--agent-dir (absolute path)");
  const margs = role ? modelArgs(input, role, deps, seat) : [];
  if (route.length || seat.length) {
    const parts = [];
    if (route.length) parts.push("attention route incomplete: missing " + route.join(", "));
    if (seat.length) parts.push("execution seat incomplete: missing " + seat.join(", "));
    throw new LaunchRefused(parts);
  }

  // Authority: a governed session may only start further sessions as its coach, within its own scope.
  const parentRole = parent.PI_ATDD_ATTENTION_ROLE?.trim();
  if (parentRole && parentRole !== "coach")
    throw new LaunchRefused(["only a coach may start governed sessions from a governed session (this one is " + parentRole + ")"]);
  if (parentRole === "coach") {
    if (role === "coach") throw new LaunchRefused(["a coach may start only workers and reviewers"]);
    if (project !== parent.PI_ATDD_ATTENTION_PROJECT_ID?.trim() || coach !== parent.PI_ATDD_ATTENTION_COACH_ADDRESS?.trim())
      throw new LaunchRefused(["a coach may launch only into its own project and coach address"]);
  }

  const coachSeat = role === "coach";
  const executionId = deps.id();
  let sessionId: string, sessionArgs: string[];
  try {
    if (text(input.session)) {
      const file = resolve(input.session!);
      sessionId = deps.readSessionId(file);
      sessionArgs = ["--session", file];
    } else {
      sessionId = deps.id();
      sessionArgs = ["--session-id", sessionId];
    }
  } catch (e) {
    throw new LaunchRefused(["session: " + (e instanceof Error ? e.message : String(e))]);
  }
  const seatAddress = coachSeat ? coach! : role + "." + slug(label!) + "@" + project!;
  const modelId = valueOf(margs, "--provider") + "/" + valueOf(margs, "--model");
  const env: Record<string, string> = {
    PI_CODING_AGENT_DIR: agentDir!, PI_ATDD_MODE: "atdd",
    PI_ATDD_ATTENTION_ROLE: role!, PI_ATDD_ATTENTION_IDENTITY: label!, PI_ATDD_ATTENTION_PROFILE: profile!,
    PI_ATDD_ATTENTION_PROJECT_ID: project!, PI_ATDD_ATTENTION_COACH_ADDRESS: coach!,
    PI_ATDD_EXECUTION_MODE: "standalone", PI_ATDD_EXECUTION_PROJECT_ID: project!,
    PI_ATDD_EXECUTION_TASK_ID: coachSeat ? "*" : task!, PI_ATDD_EXECUTION_COACH_ADDRESS: coach!,
    PI_ATDD_EXECUTION_SEAT_ADDRESS: seatAddress, PI_ATDD_EXECUTION_EXECUTION_ID: executionId,
    PI_ATDD_EXECUTION_SESSION_ID: sessionId, PI_ATDD_EXECUTION_MODEL_ID: modelId,
    PI_ATDD_EXECUTION_GENERATION: "1", PI_ATDD_EXECUTION_OWNER_TOKEN: deps.token(),
  };
  if (!coachSeat) { env.PI_ATDD_ATTENTION_TASK_ID = task!; env.PI_ATDD_ATTENTION_EXECUTION_ID = executionId; }
  try { executionConfigFromEnv(env); } catch (e) {
    throw new LaunchRefused(["execution seat: " + (e instanceof Error ? e.message : String(e))]);
  }
  return {
    role: role as LaunchRole, cwd: resolve(text(input.cwd) ?? "."),
    piArgs: [...margs, ...(role === "worker" || role === "reviewer" ? ["--exclude-tools", "mcp__wispr*,mcp__granola*,mcp__google*"] : []),
      "--name", label!, ...sessionArgs, ...(input.piArgs ?? [])],
    env, sessionId, executionId, seatAddress, modelId,
  };
}

/** The parent's ATDD variables never leak into a launched session; only the plan's own do. */
function scrubbed(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(base).filter(([k]) =>
    !k.startsWith("PI_ATDD_ATTENTION_") && !k.startsWith("PI_ATDD_EXECUTION_") && k !== "PI_ATDD_MODE"));
}

/** Bootstraps the seat (refuses on an existing different binding), then starts pi. Returns pi's status. */
export function startPi(plan: LaunchPlan, base: NodeJS.ProcessEnv = process.env): number {
  bootstrapSeat(executionConfigFromEnv(plan.env)!);
  const result = spawnSync("pi", plan.piArgs, { cwd: plan.cwd, env: { ...scrubbed(base), ...plan.env }, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const FLAGS: Record<string, keyof LaunchInput> = {
  "--role": "role", "--label": "label", "--cwd": "cwd", "--profile": "profile", "--agent-dir": "agentDir",
  "--project": "project", "--coach": "coach", "--task": "task", "--model": "model", "--tier": "tier",
  "--via": "via", "--session": "session",
};

export function parseLaunchArgs(argv: string[]): { input: LaunchInput; dryRun: boolean } {
  const input: LaunchInput = { piArgs: [] };
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") { input.piArgs = argv.slice(i + 1); break; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    const key = FLAGS[arg];
    if (!key) throw new Error("unknown launch argument: " + arg);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error("missing value for " + arg);
    (input as Record<string, unknown>)[key] = value;
  }
  return { input, dryRun };
}

/** `atdd launch ...`: prints a plan (dry run) or starts pi. Returns the process status. */
export function runLaunch(argv: string[], base: NodeJS.ProcessEnv = process.env, deps: LaunchDeps = defaultDeps): number {
  let parsed: { input: LaunchInput; dryRun: boolean };
  try { parsed = parseLaunchArgs(argv); }
  catch (e) { console.log(JSON.stringify({ status: "error", error: String(e instanceof Error ? e.message : e) })); return 2; }
  let plan: LaunchPlan;
  try { plan = planLaunch(parsed.input, deps, base); }
  catch (e) {
    const refused = e instanceof LaunchRefused ? e.missing : [String(e instanceof Error ? e.message : e)];
    console.log(JSON.stringify({ status: "refused", missing: refused, error: e instanceof Error ? e.message : String(e) }));
    return 2;
  }
  if (parsed.dryRun) {
    const env = { ...plan.env, PI_ATDD_EXECUTION_OWNER_TOKEN: "<redacted>" };
    console.log(JSON.stringify({ status: "planned", role: plan.role, seatAddress: plan.seatAddress,
      sessionId: plan.sessionId, executionId: plan.executionId, modelId: plan.modelId, pi: plan.piArgs, env }, null, 2));
    return 0;
  }
  try { return startPi(plan, base); }
  catch (e) {
    console.log(JSON.stringify({ status: "refused", missing: [], error: e instanceof Error ? e.message : String(e) }));
    return 2;
  }
}
