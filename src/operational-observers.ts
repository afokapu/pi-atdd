/**
 * ATD-41: bounded source observations, not policy or OoC decisions.
 * A positive import fact requires syntax evidence. A change fact additionally
 * requires both the pre-mutation source and the proposed source.
 */
import ts from "typescript";
import { posix } from "node:path";

export type FileKind = "source" | "test" | "e2e" | "declaration" | "generated" | "vendor";
export type FileKindEvidence =
  | { status: "observed"; kind: FileKind; basis: string }
  | { status: "unknown"; reason: string };

const SOURCE = /\.[cm]?[jt]sx?$/i;
const EXCLUDED = /(^|\/)(?:vendor|node_modules|dist|build|\.cache-sources)(\/|$)/i;
const GENERATED = /(?:^|[./_-])generated(?:[./_-]|$)/i;
const TEST = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/i;
const E2E = /(^|\/)(?:e2e|end-to-end)(\/|$)/i;

/** Generated artifacts and tests are excluded from production-source predicates.
 * Centralize the path/header heuristics so every observer shares one scope.
 */
function generatedMarker(path: string, source?: string): boolean {
  return GENERATED.test(path) || (source !== undefined &&
    /^\s*(?:\/\/|\/\*)\s*(?:@generated|generated\s+file\b)/i.test(source));
}
function testMarker(path: string): boolean {
  return TEST.test(path) || /(^|\/)(?:tests|__tests__)(\/|$)/i.test(path);
}
export function classifyFileKind(file: string, source?: string): FileKindEvidence {
  const path = file.replaceAll("\\", "/");
  if (!path || path.includes("\0")) return { status: "unknown", reason: "invalid_path" };
  if (EXCLUDED.test(path)) return { status: "observed", kind: "vendor", basis: "excluded_path" };
  if (generatedMarker(path, source))
    return { status: "observed", kind: "generated", basis: "generated_marker" };
  if (/\.d\.[cm]?ts$/i.test(path)) return { status: "observed", kind: "declaration", basis: "declaration_suffix" };
  if (!SOURCE.test(path)) return { status: "unknown", reason: "unsupported_file_kind" };
  if (E2E.test(path)) return { status: "observed", kind: "e2e", basis: "e2e_path" };
  if (testMarker(path)) return { status: "observed", kind: "test", basis: "test_path" };
  return { status: "observed", kind: "source", basis: "source_extension" };
}

/**
 * A parsed, complete TS/JS source is a limited negative witness for supported
 * AST patterns. A syntax error is UNKNOWN, never "no construct".
 */
export function sourceSyntaxEvidence(file: string, source?: string):
  { status: "observed" } | { status: "unknown"; reason: string } {
  if (source === undefined) return { status: "unknown", reason: "source_unavailable" };
  if (source.length > 1_000_000) return { status: "unknown", reason: "source_too_large" };
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if ((sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length)
    return { status: "unknown", reason: "partial_source_parse" };
  return { status: "observed" };
}

type ImportScan =
  | { status: "observed"; imports: Set<string>; unresolved: string[] }
  | { status: "unknown"; reason: string };
export type ImportEvidence = {
  present: boolean;
  added: boolean;
  sourceObserved: boolean;
  deltaObserved: boolean;
  /** Incomplete syntax, unobservable old content and unresolved aliases are not a negative verdict. */
  unknownReasons: string[];
};

const domainPrefix = (file: string): string | undefined => {
  const normalized = file.replaceAll("\\", "/");
  const index = normalized.indexOf("/domain/");
  // A project may place the domain at its root, not only below a feature.
  if (index >= 0) return normalized.slice(0, index);
  return normalized.startsWith("domain/") ? "" : undefined;
};
/** Only statically inspect module specifiers, never assume alias resolution.
 * An unsupported form is an explicit gap, not a negative dependency claim.
 */
function staticSpecifier(statement: ts.Statement, unresolved: Set<string>): string | undefined {
  if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)) {
    unresolved.add("import_equals_uninspected");
    return undefined;
  }
  const specifier = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
    ? statement.moduleSpecifier : undefined;
  if (!specifier) return undefined;
  if (!ts.isStringLiteral(specifier)) {
    unresolved.add("nonliteral_module_specifier");
    return undefined;
  }
  return specifier.text;
}
/** Resolve only relative specifiers within the observed feature root. */
function collectStaticImport(file: string, prefix: string, spec: string, imports: Set<string>, unresolved: Set<string>): void {
  if (!spec.startsWith("./") && !spec.startsWith("../")) {
    // Bare npm imports are external, but path-shaped aliases need resolution.
    if (/^(?:@|~|#|\/|src\/)/.test(spec)) unresolved.add("unresolved_import_alias");
    return;
  }
  const target = posix.normalize(posix.join(posix.dirname(file), spec));
  if (target === ".." || target.startsWith("../")) {
    unresolved.add("import_escapes_observed_root");
    return;
  }
  if (target.startsWith((prefix ? prefix + "/" : "") + "integration/"))
    imports.add(target);
}
/** Dynamic, require and import-type forms are not a clean static negative. */
function markDynamicUnknowns(sf: ts.SourceFile, unresolved: Set<string>): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) unresolved.add("dynamic_import_uninspected");
    if (ts.isImportTypeNode(node)) unresolved.add("import_type_uninspected");
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
function scanDomainImports(file: string, source: string): ImportScan {
  const path = file.replaceAll("\\", "/");
  if (source.length > 1_000_000) return { status: "unknown", reason: "source_too_large" };
  const prefix = domainPrefix(path);
  if (prefix === undefined) return { status: "observed", imports: new Set(), unresolved: [] };
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if ((sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length)
    return { status: "unknown", reason: "partial_source_parse" };
  const imports = new Set<string>();
  const unresolved = new Set<string>();
  for (const statement of sf.statements) {
    const spec = staticSpecifier(statement, unresolved);
    if (spec !== undefined) collectStaticImport(path, prefix, spec, imports, unresolved);
  }
  markDynamicUnknowns(sf, unresolved);
  return { status: "observed", imports, unresolved: [...unresolved].sort() };
}

/**
 * A present import can be witnessed in an observed source even without a prior
 * snapshot (post-tool bypass). An "added" import can only be witnessed by a
 * complete, independently supplied before/after pair.
 */
export function observeDomainImports(file: string, proposed?: string, previous?: string): ImportEvidence {
  const kind = classifyFileKind(file, proposed);
  if (kind.status === "unknown") return {
    present: false, added: false, sourceObserved: false, deltaObserved: false,
    unknownReasons: [kind.reason],
  };
  if (kind.kind !== "source" || domainPrefix(file) === undefined) return {
    // Scope is established by the path, but unread source or an absent baseline
    // cannot be reported as observed merely because the detector is inapplicable.
    present: false, added: false,
    sourceObserved: proposed !== undefined,
    deltaObserved: proposed !== undefined && previous !== undefined,
    unknownReasons: [],
  };
  if (proposed === undefined) return {
    present: false, added: false, sourceObserved: false, deltaObserved: false,
    unknownReasons: ["proposed_source_unavailable"],
  };
  const after = scanDomainImports(file, proposed);
  if (after.status === "unknown") return {
    present: false, added: false, sourceObserved: false, deltaObserved: false,
    unknownReasons: [after.reason],
  };
  const missing = after.unresolved;
  if (previous === undefined) return {
    present: after.imports.size > 0, added: false, sourceObserved: true, deltaObserved: false,
    unknownReasons: [...missing, "prior_source_unavailable"],
  };
  const before = scanDomainImports(file, previous);
  if (before.status === "unknown") return {
    present: after.imports.size > 0, added: false, sourceObserved: true, deltaObserved: false,
    unknownReasons: [...missing, "prior_" + before.reason],
  };
  return {
    present: after.imports.size > 0,
    added: [...after.imports].some(target => !before.imports.has(target)),
    sourceObserved: true,
    deltaObserved: after.unresolved.length === 0 && before.unresolved.length === 0,
    unknownReasons: [...new Set([...missing, ...before.unresolved.map(reason => "prior_" + reason)])],
  };
}
