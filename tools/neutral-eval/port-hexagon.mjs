// PLT-84 second-stack fixture: port the Bun-layout service to a ts-hexagon layout by renaming path segments.
//   domain -> core, application -> usecases, integration -> adapters, routes -> http, (old) http -> server.
// Usage: node port-hexagon.mjs <srcDir> <dstDir>   (copies all text files, renaming paths and segment references)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [src, dst] = process.argv.slice(2);
const seg = (s) => s.replaceAll("/http/", "/server/").replaceAll("/routes/", "/http/").replaceAll("/domain/", "/core/")
  .replaceAll("/application/", "/usecases/").replaceAll("/integration/", "/adapters/");
// Oracle-style prose and regex alternations that name layers without slashes on both sides.
const words = (s) => s.replace(/\((integration|application|routes)(\|(integration|application|routes))+\)/g, m =>
  m.replaceAll("integration", "adapters").replaceAll("application", "usecases").replaceAll("routes", "http"));
const walk = (d, rel = "") => { for (const f of readdirSync(join(d, rel)).sort()) {
  const r = rel ? rel + "/" + f : f, p = join(d, r);
  if (statSync(p).isDirectory()) { walk(d, r); continue; }
  const outRel = seg("/" + r).slice(1), out = join(dst, outRel);
  mkdirSync(join(out, ".."), { recursive: true });
  const text = readFileSync(p, "utf8");
  writeFileSync(out, /\.(ts|json|md|txt|yaml|yml)$/.test(f) ? words(seg(text)) : text);
} };
walk(src);
