/**
 * ATD-22: conservative source-level layer imports for the authored architecture
 * rule. Relative, statically parsed imports are evidence; aliases and dynamic
 * resolution are UNKNOWN rather than clean negative cases.
 */
import { posix } from "node:path";
import ts from "typescript";
import { classifyFileKind } from "./operational-observers.ts";

export type LayerRole = "domain"|"application"|"integration"|"presentation"|"assembly";
type Scan = {status:"observed"; edges:Set<string>; unresolved:string[]} |
  {status:"unknown";reason:string};
export type OutwardImportEvidence = {
  present:boolean;added:boolean;
  sourceObserved:boolean;deltaObserved:boolean;
  edges:string[];addedEdges:string[];unknownReasons:string[];
};
const ROLES=new Set<LayerRole>(["domain","application","integration","presentation","assembly"]);
const ALLOWED:Record<LayerRole,ReadonlySet<LayerRole>>={
  domain:new Set(["domain"]),
  application:new Set(["domain","application"]),
  integration:new Set(["domain","application","integration"]),
  presentation:new Set(["domain","application","presentation"]),
  assembly:ROLES,
};

/** Use the authored layer vocabulary, not a guessed feature/capability name. */
export function roleInPath(path:string):LayerRole|undefined {
  const p=path.replaceAll("\\","/");
  if(p.startsWith("/")||p.split("/").includes(".."))return undefined;
  const segments=p.split("/");
  const role=segments.find(s=>ROLES.has(s as LayerRole));
  return role as LayerRole|undefined;
}
/** A source import's location must be a string literal in inspectable syntax. */
function specifierOf(statement:ts.Statement,unknown:Set<string>):string|undefined {
  if(ts.isImportEqualsDeclaration(statement)) {
    unknown.add("import_equals_uninspected");return undefined;
  }
  const node=ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement)
    ? statement.moduleSpecifier : undefined;
  if(!node)return undefined;
  if(!ts.isStringLiteral(node)){unknown.add("module_specifier_unresolved");return undefined;}
  return node.text;
}
/** Detect only project-relative dependencies. An external npm package is not a layer. */
function collect(file:string,source:LayerRole,spec:string,edges:Set<string>,unknown:Set<string>):void {
  if(!spec.startsWith("./")&&!spec.startsWith("../")){
    if(/^(?:@|~|#|\/|src\/)/.test(spec))unknown.add("unresolved_import_alias");
    return;
  }
  const destination=posix.normalize(posix.join(posix.dirname(file),spec));
  if(destination===".."||destination.startsWith("../")){
    unknown.add("import_escapes_observed_root");return;
  }
  const target=roleInPath(destination);
  if(!target){unknown.add("target_layer_unresolved");return;}
  if(!ALLOWED[source].has(target))edges.add(source+"->"+target+"@"+destination);
}
/** A dynamic dependency cannot be a clean source-level negative witness. */
function dynamicUnknowns(ast:ts.SourceFile,unknown:Set<string>):void {
  const visit=(n:ts.Node):void=>{
    if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||
      (ts.isIdentifier(n.expression)&&n.expression.text==="require")))
      unknown.add("dynamic_import_uninspected");
    if(ts.isImportTypeNode(n))unknown.add("import_type_uninspected");
    ts.forEachChild(n,visit);
  };
  visit(ast);
}
function scan(file:string,source:string,role:LayerRole):Scan {
  if(source.length>1_000_000)return {status:"unknown",reason:"source_too_large"};
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,
    /\.[jt]sx$/i.test(file)?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  if((ast as ts.SourceFile&{parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics?.length)
    return {status:"unknown",reason:"partial_source_parse"};
  const unknown=new Set<string>(),edges=new Set<string>();
  for(const stmt of ast.statements){
    const spec=specifierOf(stmt,unknown);
    if(spec!==undefined)collect(file,role,spec,edges,unknown);
  }
  dynamicUnknowns(ast,unknown);
  return {status:"observed",edges,unresolved:[...unknown].sort()};
}
/** Compare exact offending target identities; moving a forbidden dependency
 * counts as a new edge, but an unchanged import does not fabricate a delta.
 */
export function observeOutwardImports(file:string,proposed?:string,previous?:string):OutwardImportEvidence {
  const empty=(reason:string[]=[]):OutwardImportEvidence=>({
    present:false,added:false,sourceObserved:false,deltaObserved:false,
    edges:[],addedEdges:[],unknownReasons:reason,
  });
  const kind=classifyFileKind(file,proposed);
  if(kind.status==="unknown")return empty([kind.reason]);
  const role=roleInPath(file);
  if(kind.kind!=="source"||!role||role==="assembly")return {
    ...empty(),sourceObserved:proposed!==undefined,
    deltaObserved:proposed!==undefined&&previous!==undefined,
  };
  if(proposed===undefined)return empty(["proposed_source_unavailable"]);
  const after=scan(file,proposed,role);
  if(after.status==="unknown")return empty([after.reason]);
  const edges=[...new Set([...after.edges].map(x=>x.split("@")[0]!))].sort();
  if(previous===undefined)return {
    present:after.edges.size>0,added:false,sourceObserved:true,deltaObserved:false,
    edges,addedEdges:[],unknownReasons:[...after.unresolved,"prior_source_unavailable"],
  };
  const before=scan(file,previous,role);
  if(before.status==="unknown")return {
    present:after.edges.size>0,added:false,sourceObserved:true,deltaObserved:false,
    edges,addedEdges:[],unknownReasons:[...after.unresolved,"prior_"+before.reason],
  };
  const added=[...after.edges].filter(x=>!before.edges.has(x));
  return {present:after.edges.size>0,added:added.length>0,
    sourceObserved:true,deltaObserved:!after.unresolved.length&&!before.unresolved.length,
    edges,addedEdges:[...new Set(added.map(x=>x.split("@")[0]!))].sort(),
    unknownReasons:[...new Set([...after.unresolved,...before.unresolved.map(x=>"prior_"+x)])],
  };
}
