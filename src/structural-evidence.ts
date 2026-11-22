/**
 * Source-grounded Pi facts, never a compliance verdict.
 * The narrow Bun observer is shared with the missing-auth source selector,
 * preventing a second, contradictory implementation of route detection.
 */
import ts from "typescript";
import { createHash } from "node:crypto";
import { inspectBunRouteAuth } from "./bun-route-auth.ts";

export type StructuralFact =
  "bun_mutating_route" | "bun_mutating_route_missing_auth" |
  "bun_mutating_route_guarded" | "bun_mutating_route_unresolved" |
  "test_urn_header" | "test_urn_missing_binding";
const IGNORE = /(^|\/)(?:vendor|dist|build|node_modules|\.cache-sources)(\/|$)/;
const SOURCE = /\.[mc]?[jt]sx?$/i;
const TEST = /(?:\.test|\.spec)\.[mc]?[jt]sx?$/i;
const cache = new Map<string, readonly StructuralFact[]>();
const MAX_CACHE = 128;

/** A header is evidence only when it precedes executable code. */
function testHeaderFacts(path:string,source:string,ast:ts.SourceFile):StructuralFact[]{
  const leading=source.slice(0,ast.statements[0]?.getStart(ast)??source.length);
  if(!/^\s*\/\/\s*URN:\s*test:[a-z0-9][a-z0-9:._-]*/im.test(leading))return [];
  const acceptance=/^\s*\/\/\s*Acceptance:\s*acc:[a-z0-9][a-z0-9:._-]*/im.test(leading);
  const train=/^\s*\/\/\s*Train:\s*\S+/im.test(leading);
  const journey=/(^|\/)(?:e2e|end-to-end|journeys?)(\/|$)|\.e2e\.|\.journey\./i.test(path);
  // Truthfulness of a declared binding is a separate reviewer obligation.
  return !acceptance&&(!train||!journey)
    ? ["test_urn_header","test_urn_missing_binding"]:["test_urn_header"];
}
/** The source observer only asserts a security concern when the handler body
 * is available and the recognized inline guard is absent. Unresolved is not
 * a clean no-rule proof.
 */
function bunAuthFacts(path:string,source:string):StructuralFact[]{
  const result=inspectBunRouteAuth(path,source);
  if(result.status==="unguarded")return [
    "bun_mutating_route","bun_mutating_route_missing_auth"];
  if(result.status==="guarded")return [
    "bun_mutating_route","bun_mutating_route_guarded"];
  if(result.status==="unknown"&&/\bBun\.serve\s*\(/.test(source))
    return ["bun_mutating_route_unresolved"];
  return [];
}
/** Deterministic, bounded TypeScript syntax facts with a content-hash cache.
 * Path, full source and comments stay in memory; telemetry records only fact IDs.
 */
export function discoverSourceEvidence(file:string,source:string):readonly StructuralFact[]{
  const path=file.replaceAll("\\","/");
  if(!SOURCE.test(path)||IGNORE.test(path)||/\.d\.ts$/.test(path)||source.length>1_000_000)
    return [];
  const digest=createHash("sha256").update(path).update("\0").update(source).digest("hex");
  const hit=cache.get(digest);
  if(hit)return hit;
  const syntax=/\.tsx$|\.jsx$/i.test(path)?ts.ScriptKind.TSX:ts.ScriptKind.TS;
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,syntax);
  if((ast as ts.SourceFile&{parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics?.length)
    return []; // the caller marks incomplete syntax UNKNOWN; do not cache false negatives.
  const result=(TEST.test(path)?testHeaderFacts(path,source,ast):
    bunAuthFacts(path,source)).sort();
  cache.set(digest,result);
  if(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value!);
  return result;
}
