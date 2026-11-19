#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digestSource, GraphError, loadCatalog, loadConfig, resolveContext, type SourceKind } from "./catalog.ts";
import { verifyTargets } from "./verify.ts";
import { checkTrackerIssue, readTrackerConfig } from "./tracker-issue.ts";

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
export function main(argv = process.argv.slice(2)): number {
  try {
    const { options, args } = parse(argv);
    const first = (name: string, fallback?: string) => options.get(name)?.[0] ?? fallback;
    const cwd = resolve(first("repo", ".")!), command = args[0];
    let output: unknown; let status = 0;
    if (command === "digest") {
      const path = first("source"), kind = first("kind") as SourceKind | undefined;
      if (!path || (kind !== "bun" && kind !== "flow")) throw new Error("digest requires --source and --kind bun|flow");
      output = { source: path, kind, sha256: digestSource(resolve(cwd, path), kind) };
    } else if (command === "context") {
      const config = loadConfig(cwd), catalog = loadCatalog(config.sources, cwd);
      const result = resolveContext(catalog, config.selectors, first("task", "")!, options.get("path") || [],
        first("operation", "task"), Number(first("limit", "12")));
      output = result;
      if (result.status === "unresolved") status = 3;
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
    } else {
      throw new Error("expected digest | context | verify | tracker");
    }
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
