/** Conservative TypeScript syntax facts, not policy verdicts. Canonical YAML is unchanged. */
import ts from "typescript";
import { createHash } from "node:crypto";

export type StructuralFact = "bun_mutating_route" | "test_urn_header";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IGNORE = /(^|\/)(?:vendor|dist|build|node_modules|\.cache-sources)(\/|$)/;
const SOURCE = /\.(?:[mc]?[jt]sx?)$/i;
const TEST = /(?:\.test|\.spec)\.(?:[mc]?[jt]sx?)$/i;
const cache = new Map<string, readonly StructuralFact[]>();
const MAX_CACHE = 128;

function nameOf(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

/** Recognize only Bun.serve route registrations, not arbitrary DELETE properties. */
export function discoverSourceEvidence(file: string, source: string): readonly StructuralFact[] {
  const path = file.replaceAll("\\", "/");
  if (!SOURCE.test(path) || IGNORE.test(path) || /\.d\.ts$/.test(path) || source.length > 1_000_000) return [];
  const digest = createHash("sha256").update(path).update("\0").update(source).digest("hex");
  const cached = cache.get(digest);
  if (cached) return cached;
  const syntax = /\.tsx$|\.jsx$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, syntax);
  const facts = new Set<StructuralFact>();
  if (sf.parseDiagnostics.length) return []; // incomplete syntax is UNKNOWN, not negative proof

  const test = TEST.test(path);
  if (test) {
    const leading = source.slice(0, sf.statements[0]?.getStart(sf) ?? source.length);
    if (/^\s*\/\/\s*URN:\s*test:[a-z0-9][a-z0-9:._-]*/im.test(leading)) facts.add("test_urn_header");
  } else {
    const bindings = new Map<string, ts.Expression>();
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) bindings.set(declaration.name.text, declaration.initializer);
      }
    }
    function objectOf(expression: ts.Expression | undefined, depth = 0): ts.ObjectLiteralExpression | undefined {
      if (!expression || depth > 4) return undefined;
      if (ts.isParenthesizedExpression(expression)) return objectOf(expression.expression, depth + 1);
      if (ts.isObjectLiteralExpression(expression)) return expression;
      if (ts.isIdentifier(expression)) return objectOf(bindings.get(expression.text), depth + 1);
      return undefined;
    }
    function member(object: ts.ObjectLiteralExpression, key: string): ts.Node | undefined {
      for (const property of object.properties) {
        if (ts.isPropertyAssignment(property) && nameOf(property.name) === key) return property.initializer;
        if (ts.isMethodDeclaration(property) && nameOf(property.name) === key) return property;
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) return bindings.get(key);
      }
      return undefined;
    }
    function hasMutatingRoute(routes: ts.ObjectLiteralExpression): boolean {
      for (const route of routes.properties) {
        if (!ts.isPropertyAssignment(route)) continue;
        const handlers = objectOf(route.initializer);
        if (handlers && handlers.properties.some(p =>
          (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && MUTATING.has(nameOf(p.name) ?? ""))) return true;
      }
      return false;
    }
    function mutatesInFetch(fetch: ts.Node): boolean {
      const aliases = new Set<string>();
      const walkAliases = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
          && ts.isPropertyAccessExpression(n.initializer) && n.initializer.name.text === "method")
          aliases.add(n.name.text);
        ts.forEachChild(n, walkAliases);
      };
      walkAliases(fetch);
      let found = false;
      const visit = (n: ts.Node): void => {
        if (ts.isBinaryExpression(n) &&
          (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
          const pair = [n.left, n.right];
          const method = pair.find(x => ts.isStringLiteral(x) && MUTATING.has(x.text.toUpperCase()));
          const access = pair.find(x =>
            (ts.isPropertyAccessExpression(x) && x.name.text === "method") ||
            (ts.isIdentifier(x) && aliases.has(x.text)));
          if (method && access) found = true;
        }
        if (!found) ts.forEachChild(n, visit);
      };
      visit(fetch);
      return found;
    }
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "serve" && ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "Bun") {
        const config = objectOf(n.arguments[0]);
        if (config) {
          const routes = objectOf(member(config, "routes") as ts.Expression | undefined);
          const fetch = member(config, "fetch");
          if ((routes && hasMutatingRoute(routes)) || (fetch && mutatesInFetch(fetch)))
            facts.add("bun_mutating_route");
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const result = [...facts].sort();
  cache.set(digest, result);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return result;
}
