#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  digestSource, GraphError, loadCatalog, loadConfig, resolveContext, resolveLegacyReference,
  type CatalogOptions, type SourceKind,
} from "./catalog.ts";
import { verifyTargets } from "./verify.ts";
import { checkTrackerIssue, readTrackerConfig } from "./tracker-issue.ts";
import { bootstrapSeatFromEnv } from "./seat-bootstrap.ts";
import { runLaunch } from "./launcher.ts";

function parse(argv: string[]): { options: Map<string, string[]>; args: string[] } {
  const options = new Map<string, string[]>(), args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i]!.startsWith("--")) { args.push(argv[i]!); continue; }
    const k = argv[i]!.slice(2), v = argv[++i];
    if (!v || v.startsWith("--")) throw new Error("missing value for --" + k);
    options.set(k, [...(options.get(k) || []), v]);
  }
  return { options, args };
}

export type Execution = { output: unknown; status: number };

/** Runs one command in-process. A usage error throws; main() reports it as JSON with exit 2. */
export function execute(argv: string[], catalogOptions: CatalogOptions = {}): Execution {
  const { options, args } = parse(argv);
  const first = (name: string, fallback?: string) => options.get(name)?.[0] ?? fallback;
  const cwd = resolve(first("repo", ".")!), command = args[0];
  let output: unknown; let status = 0;
  if (command === "digest") {
    const path = first("source"), kind = first("kind") as SourceKind | undefined;
    if (!path || (kind !== "bun" && kind !== "flow")) throw new Error("digest requires --source and --kind bun|flow");
    output = { source: path, kind, sha256: digestSource(resolve(cwd, path), kind) };
  } else if (command === "context") {
    const config = loadConfig(cwd), catalog = loadCatalog(config.sources, cwd, catalogOptions);
    const result = resolveContext(catalog, config.selectors, first("task", "")!, options.get("path") || [],
      first("operation", "task"), Number(first("limit", "12")), Number(first("offset", "0")));
    output = result;
    if (result.status === "unresolved") status = 3;
  } else if (command === "resolve") {
    // PLT-103: a legacy or current name (rule id, old convention path, URN, field key, detector ref) to its current form.
    const ref = first("ref");
    if (!ref) throw new Error("resolve needs --ref <legacy or current name>");
    const config = loadConfig(cwd), catalog = loadCatalog(config.sources, cwd, catalogOptions);
    const r = resolveLegacyReference(catalog, ref);
    output = {
      status: r.kind === "unknown" ? "unresolved" : "resolved", ref, kind: r.kind, current: r.current,
      upstream: r.upstream, detector: r.detector ?? null,
      rule: r.convention?.id ?? (r.kind === "rule" ? r.current : null),
      file: r.convention?.file ?? null, disposition: r.convention?.disposition ?? null,
    };
    if (r.kind === "unknown") status = 3;
  } else if (command === "verify") {
    const runner = first("runner", "node");
    if (runner !== "node" && runner !== "bun") throw new Error("unknown test runner");
    const result = verifyTargets(cwd, options.get("target") || [], { runner, timeoutMs: Number(first("timeout-ms", "60000")) });
    output = result; if (result.status !== "passed") status = 1;
  } else if (command === "tracker") {
    // PLT-96: exit 0 pass, 1 fail, 3 notice (not checkable, e.g. no tracker configured).
    if (args[1] !== "check") throw new Error("expected tracker check");
    const body = first("pr-body-file") ? readFileSync(resolve(cwd, first("pr-body-file")!), "utf8") : first("pr-body");
    // PLT-96 review P2: an omitted --changed would pass an unchecked change, so it is an error (exit 2), never a pass.
    const changed = options.get("changed");
    if (!changed?.length) throw new Error("tracker check needs --changed <path> for each changed file; without it the change is not checked");
    const check = checkTrackerIssue({ changedFiles: changed, branch: first("branch", "")!,
      prBody: body, tracker: readTrackerConfig(cwd) });
    output = { status: check.verdict, ...check };
    if (check.verdict === "fail") status = 1;
    if (check.verdict === "notice") status = 3;
  } else if (command === "seat") {
    // ATD-36: the launcher runs this with the PI_ATDD_EXECUTION_* it will give Pi, before Pi starts.
    if (args[1] !== "bootstrap") throw new Error("expected seat bootstrap");
    output = bootstrapSeatFromEnv(process.env);
  } else {
    throw new Error("expected digest | context | resolve | verify | tracker | seat");
  }
  return { output, status };
}

export function main(argv = process.argv.slice(2), catalogOptions: CatalogOptions = {}): number {
  // ATD-36: the canonical launch of a governed pi session (never bare pi).
  if (argv[0] === "launch") return runLaunch(argv.slice(1));
  try {
    const { output, status } = execute(argv, catalogOptions);
    console.log(JSON.stringify(output));
    return status;
  } catch (error) {
    console.log(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }));
    return 2;
  }
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  process.exitCode = main();
}
