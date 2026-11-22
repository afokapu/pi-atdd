/**
 * Narrow Bun route/handler auth evidence for ATD-22's sourced
 * coder.security.missing-auth negative controls. This does not replace
 * bun_security_hygiene_detector or grant a security-compliance verdict.
 * Unknown function resolution is NEVER a verified guarded route.
 */
import ts from "typescript";
import {classifyFileKind,sourceSyntaxEvidence} from "./operational-observers.ts";

const MUTATING=new Set(["POST","PUT","PATCH","DELETE"]);
const READ_ONLY=new Set(["GET","HEAD","OPTIONS"]);
const GUARDS=new Set([
  "authorize","requireAuth","assertAuthorized","checkAuth","verifyAuth",
  "ensureAuthenticated","requirePermission","checkPermission","assertPermission",
]);
type State="unguarded"|"guarded"|"read-only"|"unknown";
export type BunRouteAuth={status:State|"unrelated"; reasons:string[]};

/** Only statically named keys are evidence of an HTTP method. */
function keyOf(node:ts.PropertyName|undefined):string|undefined{
  if(!node)return undefined;
  if(ts.isIdentifier(node)||ts.isStringLiteral(node))return node.text;
  return undefined;
}
/** Resolve local object bindings only, never imported runtime aliases. */
function objectOf(node:ts.Expression|undefined,bindings:Map<string,ts.Expression>,
  depth=0):ts.ObjectLiteralExpression|undefined {
  if(!node||depth>4)return undefined;
  if(ts.isObjectLiteralExpression(node))return node;
  if(ts.isParenthesizedExpression(node))return objectOf(node.expression,bindings,depth+1);
  if(ts.isIdentifier(node))return objectOf(bindings.get(node.text),bindings,depth+1);
  return undefined;
}
function member(obj:ts.ObjectLiteralExpression,key:string):ts.Node|undefined{
  for(const p of obj.properties){
    if((ts.isPropertyAssignment(p)||ts.isMethodDeclaration(p))&&keyOf(p.name)===key)return p;
    if(ts.isShorthandPropertyAssignment(p)&&p.name.text===key)return p;
  }
  return undefined;
}
/** A referenced handler without its body is UNKNOWN, not authenticated. */
function bodyOf(node:ts.Node|undefined):ts.Node|undefined{
  if(!node)return undefined;
  if(ts.isPropertyAssignment(node))return bodyOf(node.initializer);
  if(ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isMethodDeclaration(node))
    return node.body;
  return undefined;
}
/** A guard in a nested callback cannot protect its enclosing handler. */
function hasDirectGuard(body:ts.Node):boolean {
  let seen=false;
  const walk=(node:ts.Node):void=>{
    if(seen)return;
    if(node!==body&&(ts.isArrowFunction(node)||ts.isFunctionExpression(node)||
      ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)))return;
    if(ts.isCallExpression(node)){
      const x=node.expression;
      const name=ts.isIdentifier(x)?x.text:ts.isPropertyAccessExpression(x)?x.name.text:undefined;
      if(name&&GUARDS.has(name)){seen=true;return;}
    }
    ts.forEachChild(node,walk);
  };
  walk(body);
  return seen;
}
const handlerState=(handler:ts.Node|undefined):State=>{
  const body=bodyOf(handler);
  return !body?"unknown":hasDirectGuard(body)?"guarded":"unguarded";
};
/** Inspect all route methods, not just the first or recently edited method. */
function routeStates(routes:ts.ObjectLiteralExpression,
  bindings:Map<string,ts.Expression>):State[] {
  const states:State[]=[];
  for(const route of routes.properties){
    if(!ts.isPropertyAssignment(route)){states.push("unknown");continue;}
    const methods=objectOf(route.initializer,bindings);
    if(!methods){states.push("unknown");continue;}
    for(const handler of methods.properties){
      if(!ts.isPropertyAssignment(handler)&&!ts.isMethodDeclaration(handler)){
        states.push("unknown");continue;
      }
      const method=keyOf(handler.name)?.toUpperCase();
      if(!method){states.push("unknown");continue;}
      if(MUTATING.has(method))states.push(handlerState(handler));
      else if(READ_ONLY.has(method))states.push("read-only");
      else states.push("unknown");
    }
  }
  return states.length?states:["unknown"];
}
/** Recognize a method branch only when its comparison is source-visible. */
function methodBranch(node:ts.Expression,aliases:Set<string>):boolean{
  if(!ts.isBinaryExpression(node)||![
    ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken,
  ].includes(node.operatorToken.kind))return false;
  const pair=[node.left,node.right];
  if(!pair.some(x=>ts.isStringLiteral(x)&&MUTATING.has(x.text.toUpperCase())))return false;
  return pair.some(x=>ts.isPropertyAccessExpression(x)&&x.name.text==="method"||
    ts.isIdentifier(x)&&aliases.has(x.text));
}
/** Sibling guards do not satisfy an unguarded POST/PATCH/DELETE branch. */
function fetchStates(handler:ts.Node|undefined):State[] {
  const body=bodyOf(handler);
  if(!body)return ["unknown"];
  const aliases=new Set<string>();
  const collect=(n:ts.Node):void=>{
    if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&
      ts.isPropertyAccessExpression(n.initializer)&&n.initializer.name.text==="method")
      aliases.add(n.name.text);
    ts.forEachChild(n,collect);
  };
  collect(body);
  const results:State[]=[];
  const visit=(n:ts.Node):void=>{
    if(ts.isIfStatement(n)&&methodBranch(n.expression,aliases))
      results.push(hasDirectGuard(n.thenStatement)?"guarded":"unguarded");
    ts.forEachChild(n,visit);
  };
  visit(body);
  return results.length?results:["unknown"];
}
/** Deterministic, bounded source witness, not permission or detector authority. */
export function inspectBunRouteAuth(file:string,source?:string):BunRouteAuth{
  if(source===undefined)return {status:"unknown",reasons:["source_unavailable"]};
  const kind=classifyFileKind(file,source);
  if(kind.status!=="observed")return {status:"unknown",reasons:[kind.reason]};
  if(kind.kind!=="source")return {status:"unrelated",reasons:[]};
  const syntax=sourceSyntaxEvidence(file,source);
  if(syntax.status!=="observed")return {status:"unknown",reasons:[syntax.reason]};
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const bindings=new Map<string,ts.Expression>();
  for(const statement of ast.statements){
    if(!ts.isVariableStatement(statement))continue;
    for(const entry of statement.declarationList.declarations)
      if(ts.isIdentifier(entry.name)&&entry.initializer)bindings.set(entry.name.text,entry.initializer);
  }
  const states:State[]=[];
  let buns=0;
  const visit=(n:ts.Node):void=>{
    if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&
      ts.isIdentifier(n.expression.expression)&&n.expression.expression.text==="Bun"&&
      n.expression.name.text==="serve"){
      buns++;
      const cfg=objectOf(n.arguments[0],bindings);
      if(!cfg){states.push("unknown");return;}
      const r=member(cfg,"routes"),f=member(cfg,"fetch");
      const routeObj=r&&ts.isPropertyAssignment(r)?objectOf(r.initializer,bindings):
        r&&ts.isShorthandPropertyAssignment(r)?objectOf(bindings.get(r.name.text),bindings):undefined;
      if(r)states.push(...(routeObj?routeStates(routeObj,bindings):["unknown"]));
      if(f)states.push(...fetchStates(f));
      if(!r&&!f)states.push("unknown");
    }
    ts.forEachChild(n,visit);
  };
  visit(ast);
  if(!buns)return {status:"unrelated",reasons:[]};
  if(states.includes("unguarded"))return {status:"unguarded",reasons:[]};
  if(states.includes("unknown"))return {status:"unknown",reasons:["route_or_handler_unresolved"]};
  if(states.includes("guarded"))return {status:"guarded",reasons:[]};
  return {status:"read-only",reasons:[]};
}
