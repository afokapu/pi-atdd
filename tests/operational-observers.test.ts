import test from "node:test";
import assert from "node:assert/strict";
import { classifyFileKind, observeDomainImports, sourceSyntaxEvidence } from "../src/operational-observers.ts";
import { shellStaticWriteContents } from "../src/shell-targets.ts";

const path = "src/orders/domain/price.ts";
const initial = 'import { calculate } from "../domain/calculate";\nexport const price = calculate;\n';
const outbound = 'import { gateway } from "../integration/network";\n' + initial;

test("file kind is classified only from inspectable paths and markers", () => {
  assert.equal(classifyFileKind("src/orders/price.ts").status, "observed");
  assert.deepEqual(classifyFileKind("src/order.test.ts"), { status:"observed", kind:"test", basis:"test_path" });
  assert.deepEqual(classifyFileKind("src/e2e/checkout.ts"), { status:"observed", kind:"e2e", basis:"e2e_path" });
  assert.equal((classifyFileKind("src/vendor/a.ts") as {kind:string}).kind, "vendor");
  assert.equal((classifyFileKind("src/foo.generated.ts") as {kind:string}).kind, "generated");
  assert.equal((classifyFileKind("src/foo.d.ts") as {kind:string}).kind, "declaration");
  assert.deepEqual(classifyFileKind("docs/ADR.md"), {status:"unknown",reason:"unsupported_file_kind"});
  assert.equal((classifyFileKind("src/orders/price.ts", "// @generated\nexport {};") as {kind:string}).kind, "generated");
});

test("AST import delta requires a complete before/after proposal", () => {
  const added=observeDomainImports(path,outbound,initial);
  assert.equal(added.present,true);
  assert.equal(added.added,true);
  assert.equal(added.deltaObserved,true);
  assert.deepEqual(added.unknownReasons,[]);
  const unchanged=observeDomainImports(path,outbound,outbound);
  assert.equal(unchanged.present,true);
  assert.equal(unchanged.added,false);
  assert.equal(unchanged.deltaObserved,true);
  const removed=observeDomainImports(path,initial,outbound);
  assert.equal(removed.present,false);
  assert.equal(removed.added,false);
  const internal=observeDomainImports(path,initial,"");
  assert.equal(internal.present,false);
  assert.equal(internal.added,false);
});

test("missing prior, partial syntax, alias and excluded source cannot assert a new change", () => {
  const post=observeDomainImports(path,outbound);
  assert.equal(post.present,true,"post-tool code may contain an independently observed import");
  assert.equal(post.added,false,"post-tool syntax does not prove when the import appeared");
  assert.ok(post.unknownReasons.includes("prior_source_unavailable"));
  const invalid=observeDomainImports(path,"import {",initial);
  assert.equal(invalid.added,false);
  assert.ok(invalid.unknownReasons.includes("partial_source_parse"));
  assert.equal(sourceSyntaxEvidence(path,"import {").status,"unknown");
  const alias=observeDomainImports(path,'import x from "@/integration/gateway";',initial);
  assert.equal(alias.added,false);
  assert.ok(alias.unknownReasons.includes("unresolved_import_alias"));
  const excluded=observeDomainImports("vendor/orders/domain/price.ts",outbound,initial);
  assert.equal(excluded.added,false);
  assert.equal(excluded.present,false);
  const nonDomain=observeDomainImports("src/orders/application/price.ts",outbound,initial);
  assert.equal(nonDomain.added,false);
  assert.equal(nonDomain.sourceObserved,true);
  assert.equal(nonDomain.deltaObserved,true);
  // Path-based detector inapplicability is NOT a source or delta observation.
  const absent=observeDomainImports("src/orders/application/price.ts");
  assert.equal(absent.sourceObserved,false);
  assert.equal(absent.deltaObserved,false);
  const absentExcluded=observeDomainImports("vendor/orders/domain/price.ts");
  assert.equal(absentExcluded.sourceObserved,false);
  assert.equal(absentExcluded.deltaObserved,false);
  const noBaseline=observeDomainImports("src/orders/application/price.ts",initial);
  assert.equal(noBaseline.sourceObserved,true);
  assert.equal(noBaseline.deltaObserved,false);
});

test("root domain and static re-exports activate architecture facts without task-language hints", () => {
  const atRoot="domain/price.ts";
  const reexport='export { gateway } from "../integration/network";\n';
  const observed=observeDomainImports(atRoot,reexport,initial);
  assert.equal(observed.present,true);
  assert.equal(observed.added,true);
  assert.equal(observed.deltaObserved,true);
  assert.deepEqual(observed.unknownReasons,[]);
});

test("uninspected dependency forms stay UNKNOWN rather than establishing a clean negative", () => {
  const examples=[
    ['const loader = import("../integration/network");\n', "dynamic_import_uninspected"],
    ['const loader = require("../integration/network");\n', "dynamic_import_uninspected"],
    ['type Network = typeof import("../integration/network");\n', "import_type_uninspected"],
    ['import gateway = require("../integration/network");\n', "import_equals_uninspected"],
    ['import { gateway } from "@core/integration/network";\n', "unresolved_import_alias"],
  ] as const;
  for(const [text,reason] of examples) {
    const observed=observeDomainImports(path,initial+text,initial);
    assert.equal(observed.added,false,reason);
    assert.equal(observed.deltaObserved,false,reason);
    assert.ok(observed.unknownReasons.includes(reason),reason);
  }
  const external=observeDomainImports(path,initial+'import ts from "typescript";\n',initial);
  assert.equal(external.deltaObserved,true,"ordinary bare packages are outside local dependency scan");
});

test("source parse is explicit UNKNOWN for syntax errors; clean negative is limited to inspected syntax", () => {
  assert.deepEqual(sourceSyntaxEvidence("src/server.ts","Bun.serve({ routes: {"),
    {status:"unknown",reason:"partial_source_parse"});
  assert.deepEqual(sourceSyntaxEvidence("src/server.ts","const value=1;"),{status:"observed"});
  assert.deepEqual(sourceSyntaxEvidence("src/server.ts"),{status:"unknown",reason:"source_unavailable"});
});

test("quoted literal cat heredocs supply a conservative shell proposal", () => {
  const command="cat > src/orders/domain/price.ts <<'EOF'\n"+outbound+"EOF";
  assert.equal(shellStaticWriteContents(command).get(path),outbound);
  assert.equal(shellStaticWriteContents("cat <<'EOF' > src/orders/domain/price.ts\n"+outbound+"EOF").get(path),outbound);
  assert.equal(shellStaticWriteContents("cat > "+path+" <<EOF\n"+outbound+"EOF").size,0,
    "unquoted delimiter can expand shell variables");
  assert.equal(shellStaticWriteContents("cat > "+path+" <<'EOF'\n"+outbound).size,0,
    "unterminated heredoc is not a proposal");
  assert.equal(shellStaticWriteContents("cat > "+path+" <<'EOF'; rm -rf .\n"+outbound+"EOF").size,0);
  assert.equal(shellStaticWriteContents(command+"\nprintf 'override' > "+path).size,0,
    "a later write makes the preflight proposal untrustworthy");
  assert.equal(shellStaticWriteContents("true\n"+command).size,0,
    "preconditions and shell scripts are not a standalone static write");
  assert.equal(shellStaticWriteContents(command+"\ncat > src/other.ts <<'NEXT'\nexport {};\nNEXT").size,0,
    "multiple writes require independent source observation");
});
