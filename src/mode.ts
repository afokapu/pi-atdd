/**
 * PLT-93: per-repository working mode. `atdd` applies conventions and edit
 * guards; `plain` keeps the extension loaded but injects and blocks nothing.
 * Resolution never waits for a human: asking is the caller's decision, and
 * only interactive (TUI) sessions may ask.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Mode = "atdd" | "plain";
export type Resolution = { mode: Mode | null; source: string };
export const MODE_FILE = ".atdd-pi/mode";

const parse = (value: unknown): Mode | undefined => {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v === "atdd" || v === "plain" ? v : undefined;
};

/** Explicit phrases only; "plain text" or "plain English" are not mode requests. */
export function modeFromText(text: string): Mode | undefined {
  const t = text.toLowerCase();
  if (/\b(no|without)\s+atdd\b/.test(t) || /\bplain\s+mode\b/.test(t) ||
      /(^|[,;:.!?(]\s*)plain\s*(?=[,;:.!?)]|$)/m.test(t)) return "plain";
  if (/\b(use|with)\s+atdd\b/.test(t)) return "atdd";
  return undefined;
}

/**
 * Nearest ancestor holding `.git`, `.jj` or an explicit `atdd-pi.yaml` (a project
 * that opted in to ATDD); null when the directory is not in a repository.
 */
export function repositoryRoot(cwd: string): string | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if ([".git", ".jj", "atdd-pi.yaml"].some(marker => existsSync(join(dir, marker)))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

export function recordedMode(root: string): Mode | undefined {
  try { return parse(readFileSync(join(root, MODE_FILE), "utf8")); } catch { return undefined; }
}
export function recordMode(root: string, mode: Mode): void {
  mkdirSync(join(root, ".atdd-pi"), { recursive: true });
  writeFileSync(join(root, MODE_FILE), mode + "\n");
}
/** A repository that already declares ATDD (pi-atdd config or an ATDD plan directory). */
export function declaresAtdd(root: string): boolean {
  if (existsSync(join(root, "atdd-pi.yaml"))) return true;
  try { return statSync(join(root, "plan")).isDirectory(); } catch { return false; }
}

/** Message → PI_ATDD_MODE → recorded choice → ATDD markers; null means undecided. */
export function resolveMode(input: { cwd: string; text?: string; env?: NodeJS.ProcessEnv }): Resolution {
  const root = repositoryRoot(input.cwd);
  if (!root) return { mode: "plain", source: "outside a repository" };
  const said = modeFromText(input.text ?? "");
  if (said) return { mode: said, source: "your message" };
  const env = parse(input.env?.PI_ATDD_MODE);
  if (env) return { mode: env, source: "PI_ATDD_MODE" };
  const recorded = recordedMode(root);
  if (recorded) return { mode: recorded, source: MODE_FILE };
  if (declaresAtdd(root)) return { mode: "atdd", source: "repository declares ATDD" };
  return { mode: null, source: "undecided" };
}
