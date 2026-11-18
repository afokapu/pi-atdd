/**
 * Read-only repository observation used after tools that may bypass Pi write/edit.
 * A clean status by itself is not proof of no mutation: compare heads and
 * fingerprints, and never assume the presence of Git or JJ.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type RepositorySnapshot = {
  kind: "git" | "jj"; revision: string | null;
  dirty: Map<string,string>;
};
export type RepositoryDelta = {
  status: "observed" | "unknown"; changedPaths: string[];
  snapshot?: RepositorySnapshot; reason?: string;
};
const args = (name:string, arguments_: string[], cwd:string) =>
  execFileSync(name, arguments_, {cwd,encoding:"utf8",timeout:2500,maxBuffer:512_000,windowsHide:true});
const pathsFrom = (text:string):string[] => text.split("\0").filter(Boolean);
const safe = (cwd:string,path:string):string|null => {
  const full=resolve(cwd,path),relativeFile=relative(cwd,full);
  if (!relativeFile || relativeFile===".." || relativeFile.startsWith(".."+sep) || isAbsolute(relativeFile)) return null;
  return relativeFile.replaceAll("\\","/");
};
function fingerprint(cwd:string,path:string):string {
  try {
    const full=resolve(cwd,path);
    if (!existsSync(full)) return "deleted";
    const stat=statSync(full);
    if (!stat.isFile()) return "non-file";
    if (stat.size>2_000_000) return "large:"+stat.size+":"+stat.mtimeMs;
    return createHash("sha256").update(readFileSync(full)).digest("hex");
  } catch { return "unreadable"; }
}
function git(cwd:string):RepositorySnapshot {
  if (args("git",["rev-parse","--is-inside-work-tree"],cwd).trim()!=="true")
    throw new Error("not a Git worktree");
  const revision=args("git",["rev-parse","HEAD"],cwd).trim();
  const dirty=new Set([
    ...pathsFrom(args("git",["diff","--no-ext-diff","--no-textconv","--name-only","-z","HEAD","--"],cwd)),
    ...pathsFrom(args("git",["ls-files","--others","--exclude-standard","-z"],cwd)),
  ]);
  const files=new Map<string,string>();
  for (const path of dirty) {
    const relativePath=safe(cwd,path);
    if (relativePath) files.set(relativePath,fingerprint(cwd,relativePath));
  }
  return {kind:"git",revision,dirty:files};
}
function jj(cwd:string):RepositorySnapshot {
  const revision=args("jj",["log","-r","@","--no-graph","-T","commit_id"],cwd).trim();
  const dirty=new Map<string,string>();
  const output=args("jj",["diff","--name-only"],cwd);
  for (const path of output.split("\n")) {
    const name=safe(cwd,path.trim());
    if (name) dirty.set(name,fingerprint(cwd,name));
  }
  return {kind:"jj",revision:revision||null,dirty};
}
export function observeRepository(cwd:string,previous?:RepositorySnapshot):RepositoryDelta {
  let current:RepositorySnapshot;
  try {current=git(cwd);} catch {
    try { current=jj(cwd); }
    catch {return {status:"unknown",changedPaths:[],reason:"No readable Git/JJ repository; post-tool file mutations cannot be independently observed"};}
  }
  const changed=new Set<string>();
  if (previous && current.kind===previous.kind) {
    for (const [path,hash] of current.dirty) if (previous.dirty.get(path)!==hash) changed.add(path);
    for (const path of previous.dirty.keys()) if (!current.dirty.has(path)) changed.add(path);
    if (current.revision && previous.revision && current.revision!==previous.revision) {
      try {
        if (current.kind==="git") {
          const output=args("git",["diff","--no-ext-diff","--no-textconv","--name-only","-z",
            previous.revision,current.revision,"--"],cwd);
          for (const file of pathsFrom(output)) {
            const name=safe(cwd,file);if(name) changed.add(name);
          }
        } else {
          const output=args("jj",["diff","--name-only","--from",previous.revision,"--to",current.revision],cwd);
          for(const file of output.split("\n")) {
            const name=safe(cwd,file.trim());if(name)changed.add(name);
          }
        }
      } catch {
        return {status:"unknown",snapshot:current,changedPaths:[],reason:"Cannot compare repository revisions"};
      }
    }
  }
  return {status:"observed",changedPaths:[...changed].sort(),snapshot:current};
}
