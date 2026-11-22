/**
 * Bounded Bun route authorization observer, not a security waiver.
 * This implements source-grounded positives and known negatives from the
 * immutable missing-auth convention without trusting task language.
 * Unresolved handlers, late guards and dynamic config stay UNKNOWN.
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

/** Static method names only; computed methods are not assumed safe. */
function keyOf(node:ts.PropertyName|undefined):string|undefined{
  if(!node)return undefined;
  if(ts.isIdentifier(node)||ts.isStringLiteral(node))return node.text;
  return undefined;
}
/** Local object aliases are bounded by depth, not recursively evaluated. */
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
/** Imported handler bodies are unobservable; no inferred call graph. */
function bodyOf(node:ts.Node|undefined):ts.Node|undefined{
  if(!node)return undefined;
  if(ts.isPropertyAssignment(node))return bodyOf(node.initializer);
  if(ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isMethodDeclaration(node))
    return node.body;
  return undefined;
}
function nestedFunction(node:ts.Node):boolean {
  return ts.isArrowFunction(node)||ts.isFunctionExpression(node)||
    ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node);
}
function callName(node:ts.Node):string|undefined{
  if(!ts.isCallExpression(node))return undefined;
  const x=node.expression;
  if(ts.isIdentifier(x))return x.text;
  if(ts.isPropertyAccessExpression(x))return x.name.text;
  return undefined;
}
/** Never count a guard hidden in an uninvoked inner callback. */
function hasDirectGuard(body:ts.Node):boolean {
  let seen=false;
  const walk=(n:ts.Node):void=>{
    if(seen||(n!==body&&nestedFunction(n)))return;
    const name=callName(n);
    if(name&&GUARDS.has(name)){seen=true;return;}
    ts.forEachChild(n,walk);
  };
  walk(body);
  return seen;
}
/** A recognized guard must precede other executable handler statements.
 * If its position is ambiguous, retain UNKNOWN instead of a clean finding.
 */
function guardCall(node:ts.Node|undefined):boolean{
  if(!node)return false;
  if(ts.isExpressionStatement(node))return guardCall(node.expression);
  if(ts.isAwaitExpression(node))return guardCall(node.expression);
  const name=callName(node);
  return !!name&&GUARDS.has(name);
}
function guardAtEntry(body:ts.Node):boolean{
  if(ts.isBlock(body))return guardCall(body.statements[0]);
  return guardCall(body);
}
const handlerState=(handler:ts.Node|undefined):State=>{
  const body=bodyOf(handler);
  if(!body)return "unknown";
  if(guardAtEntry(body))return "guarded";
  // A late, conditional, or shadowed guard is NOT source-backed authorization.
  return hasDirectGuard(body)?"unknown":"unguarded";
};
/** Each method obtains a separate support; sibling guards do not leak. */
function methodState(node:ts.ObjectLiteralElementLike):State{
  if(!ts.isPropertyAssignment(node)&&!ts.isMethodDeclaration(node))return "unknown";
  const method=keyOf(node.name)?.toUpperCase();
  if(!method)return "unknown";
  if(MUTATING.has(method))return handlerState(node);
  if(READ_ONLY.has(method))return "read-only";
  return "unknown";
}
function routeStates(routes:ts.ObjectLiteralExpression,
  bindings:Map<string,ts.Expression>):State[] {
  const states:State[]=[];
  for(const route of routes.properties){
    if(!ts.isPropertyAssignment(route)){states.push("unknown");continue;}
    const methods=objectOf(route.initializer,bindings);
    if(!methods){states.push("unknown");continue;}
    for(const handler of methods.properties)states.push(methodState(handler));
  }
  return states.length?states:["unknown"];
}
/** A source-visible mutating comparison is required for fetch branches. */
/** An arbitrary object's `method` property must not be confused with
 * the request argument of Bun's fetch handler.
 */
function isRequestMethod(n:ts.Node,request:string):boolean {
  return ts.isPropertyAccessExpression(n)&&n.name.text==="method"&&
    ts.isIdentifier(n.expression)&&n.expression.text===request;
}
function methodBranch(node:ts.Expression,aliases:Set<string>,request:string):boolean{
  if(!ts.isBinaryExpression(node))return false;
  const op=node.operatorToken.kind;
  if(op!==ts.SyntaxKind.EqualsEqualsEqualsToken&&op!==ts.SyntaxKind.EqualsEqualsToken)return false;
  const pair=[node.left,node.right];
  const mutates=pair.some(x=>ts.isStringLiteral(x)&&MUTATING.has(x.text.toUpperCase()));
  const method=pair.some(x=>isRequestMethod(x,request)||
    ts.isIdentifier(x)&&aliases.has(x.text));
  return mutates&&method;
}
/** Alias evidence is only local and restricted to observed request method reads. */
function methodAliases(body:ts.Node,request:string):Set<string>{
  const aliases=new Set<string>();
  const visit=(n:ts.Node):void=>{
    if(n!==body&&nestedFunction(n))return;
    if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&
      isRequestMethod(n.initializer,request))aliases.add(n.name.text);
    ts.forEachChild(n,visit);
  };
  visit(body);
  return aliases;
}
function fetchBranchStates(body:ts.Node,aliases:Set<string>,request:string):State[]{
  const result:State[]=[];
  const visit=(n:ts.Node):void=>{
    if(n!==body&&nestedFunction(n))return;
    if(ts.isIfStatement(n)&&methodBranch(n.expression,aliases,request)){
      if(guardAtEntry(n.thenStatement))result.push("guarded");
      else result.push(hasDirectGuard(n.thenStatement)?"unknown":"unguarded");
    }
    ts.forEachChild(n,visit);
  };
  visit(body);
  return result;
}
/** A fetch handler without a named request parameter cannot assert a method. */
function fetchRequestName(node:ts.Node|undefined):string|undefined {
  const fn=node&&ts.isMethodDeclaration(node)?node:
    node&&ts.isPropertyAssignment(node)&&
      (ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))
      ?node.initializer:undefined;
  const name=fn?.parameters[0]?.name;
  return name&&ts.isIdentifier(name)?name.text:undefined;
}
/** Do not treat an opaque fetch function as a read-only handler. */
function fetchStates(handler:ts.Node|undefined):State[]{
  const body=bodyOf(handler),request=fetchRequestName(handler);
  if(!body||!request)return ["unknown"];
  const states=fetchBranchStates(body,methodAliases(body,request),request);
  return states.length?states:["unknown"];
}
/** Allow only resolved local route maps, never arbitrary computed config. */
function routeObject(node:ts.Node|undefined,
  bindings:Map<string,ts.Expression>):ts.ObjectLiteralExpression|undefined{
  if(node&&ts.isPropertyAssignment(node))return objectOf(node.initializer,bindings);
  if(node&&ts.isShorthandPropertyAssignment(node))
    return objectOf(bindings.get(node.name.text),bindings);
  return undefined;
}
/** An aliased route map or config can be mutated after declaration.
 * It may support a witnessed violation, never a proof of a clean handler.
 */
function aliasMayChange(call:ts.CallExpression,routes:ts.Node|undefined):boolean{
  const cfg=call.arguments[0];
  if(!cfg||!ts.isObjectLiteralExpression(cfg))return true;
  if(!routes)return false;
  if(ts.isShorthandPropertyAssignment(routes))return true;
  if(ts.isPropertyAssignment(routes))return !ts.isObjectLiteralExpression(routes.initializer);
  return true;
}
function serveStates(call:ts.CallExpression,bindings:Map<string,ts.Expression>):State[]{
  const cfg=objectOf(call.arguments[0],bindings);
  if(!cfg)return ["unknown"];
  const routes=member(cfg,"routes"),fetch=member(cfg,"fetch");
  const states:State[]=[];
  if(routes){
    const resolved=routeObject(routes,bindings);
    states.push(...(resolved?routeStates(resolved,bindings):(["unknown"]as State[])));
  }
  if(fetch)states.push(...fetchStates(fetch));
  if(aliasMayChange(call,routes)&&!states.includes("unguarded"))return ["unknown"];
  return states.length?states:["unknown"];
}
/** A Bun.serve call must be an actual syntax node, not a task keyword. */
function isBunServe(n:ts.Node):n is ts.CallExpression{
  if(!ts.isCallExpression(n)||!ts.isPropertyAccessExpression(n.expression))return false;
  const x=n.expression;
  return ts.isIdentifier(x.expression)&&x.expression.text==="Bun"&&x.name.text==="serve";
}
function topLevelBindings(ast:ts.SourceFile):Map<string,ts.Expression>{
  const bindings=new Map<string,ts.Expression>();
  for(const statement of ast.statements){
    if(!ts.isVariableStatement(statement))continue;
    for(const item of statement.declarationList.declarations)
      if(ts.isIdentifier(item.name)&&item.initializer)bindings.set(item.name.text,item.initializer);
  }
  return bindings;
}
function collectStates(ast:ts.SourceFile):{buns:number;states:State[]}{
  const bindings=topLevelBindings(ast),states:State[]=[];
  let buns=0;
  const visit=(n:ts.Node):void=>{
    if(isBunServe(n)){buns++;states.push(...serveStates(n,bindings));}
    ts.forEachChild(n,visit);
  };
  visit(ast);
  return {buns,states};
}
/** UNKNOWN outranks apparently guarded routes when another handler is opaque. */
function summarize(checked:{buns:number;states:State[]}):BunRouteAuth{
  const {buns,states}=checked;
  if(!buns)return {status:"unrelated",reasons:[]};
  if(states.includes("unguarded"))return {status:"unguarded",reasons:[]};
  if(states.includes("unknown"))return {status:"unknown",reasons:["route_or_handler_unresolved"]};
  if(states.includes("guarded"))return {status:"guarded",reasons:[]};
  return {status:"read-only",reasons:[]};
}
/** Reject unusable source before collecting positive or negative findings. */
function sourceGap(file:string,source:string):BunRouteAuth|undefined{
  const kind=classifyFileKind(file,source);
  if(kind.status!=="observed")return {status:"unknown",reasons:[kind.reason]};
  if(kind.kind!=="source")return {status:"unrelated",reasons:[]};
  const syntax=sourceSyntaxEvidence(file,source);
  if(syntax.status!=="observed")return {status:"unknown",reasons:[syntax.reason]};
  return undefined;
}
/** Read-only observer: no execution, no dynamic import resolution, no authority. */
export function inspectBunRouteAuth(file:string,source?:string):BunRouteAuth{
  if(source===undefined)return {status:"unknown",reasons:["source_unavailable"]};
  const gap=sourceGap(file,source);
  if(gap)return gap;
  const kind=/\.[jt]sx$/i.test(file)?ts.ScriptKind.TSX:ts.ScriptKind.TS;
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,kind);
  return summarize(collectStates(ast));
}
