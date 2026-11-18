#!/usr/bin/env node
import { resolve } from "node:path";
import { digestSource, GraphError, loadCatalog, loadConfig, resolveContext, type SourceKind } from "./catalog.ts";
import { verifyTargets } from "./verify.ts";

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
    } else {
      throw new Error("expected digest | context | verify");
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
