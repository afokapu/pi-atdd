/**
 * Best-effort static extraction of files a shell command may create, modify or
 * delete, so shell edits can be preflighted with the same rules as Pi's
 * edit/write tools. This is deliberately conservative and incomplete: commands
 * whose targets are computed at runtime (variables, globs, `cd`, opaque
 * scripts) are not resolved here. Post-tool repository observation remains
 * the backstop for every non-read tool; an empty result is NOT proof that the
 * command is read-only.
 */
const PATHISH = /^[A-Za-z0-9_./@+-][A-Za-z0-9_./@+,=-]*$/;
const TOKEN = /'[^']*'|"[^"]*"|[^\s'"]+/g;

function unquote(token: string): string {
  if (token.length >= 2 && ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))))
    return token.slice(1, -1);
  return token;
}

/** Remove here-document bodies so their contents are not parsed as commands. */
export function stripHeredocBodies(command: string): string {
  const lines = command.split("\n"), kept: string[] = [];
  const pending: Array<{ word: string; dash: boolean }> = [];
  for (const line of lines) {
    if (pending.length) {
      const head = pending[0]!;
      if ((head.dash ? line.replace(/^\t+/, "") : line) === head.word) pending.shift();
      continue;
    }
    kept.push(line);
    for (const m of line.matchAll(/<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g))
      pending.push({ word: m[3]!, dash: m[1] === "-" });
  }
  return kept.join("\n");
}

export type ShellWriteTarget = { path: string; mode: "write" | "edit" };
/** Targets only (compatibility). */
export function shellWriteTargets(command: string): string[] {
  return shellWriteTargetModes(command).map(t => t.path);
}
/**
 * Targets with their write mode: "write" replaces the whole file (like Pi's
 * write tool: `>`, heredoc, `tee`, cp/mv/install destination, writeFileSync),
 * "edit" modifies it in place (`>>`, `tee -a`, sed/perl -i, append, patch).
 */
export function shellWriteTargetModes(command: string): ShellWriteTarget[] {
  if (typeof command !== "string" || !command) return [];
  const modes = new Map<string, "write" | "edit">();
  let mode: "write" | "edit" = "write";
  const out = { add: (t: string) => { if (modes.get(t) !== "write") modes.set(t, mode); } };
  const add = (raw: string | undefined, m: "write" | "edit" = "write") => {
    mode = m;
    if (!raw) return;
    const t = unquote(raw.trim());
    if (!t || t.startsWith("-") || t.startsWith("&") || /[$`*?{}\s]/.test(t)) return;
    if (t.startsWith("/dev/")) return;
    if (!PATHISH.test(t) && !t.startsWith("/")) return;
    out.add(t);
  };
  const shell = stripHeredocBodies(command);

  // Output redirections: > file, >> file, 1> file, &> file (not >&2, not 2>&1).
  for (const m of shell.matchAll(/(?:^|[^<>&=\-0-9])([0-9]?>>?|&>>?)\|?\s*('[^']*'|"[^"]*"|[^\s;&|<>()]+)/g))
    add(m[2], m[1]!.endsWith(">>") ? "edit" : "write");

  // Simple commands, split on control operators.
  for (const segment of shell.split(/\n|;|&&|\|\||\|/)) {
    const tokens = (segment.match(TOKEN) ?? []).filter(t => !/^[0-9]?>|^&>|^</.test(t));
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]!)) tokens.shift(); // env assignments
    if (tokens[0] === "sudo" || tokens[0] === "command" || tokens[0] === "env") tokens.shift();
    const cmd = tokens[0] ? unquote(tokens[0]).split("/").at(-1)! : "";
    const args = tokens.slice(1);
    const operands = args.filter(a => !a.startsWith("-"));
    if (cmd === "tee") operands.forEach(o => add(o, args.some(a => /^-[a-z]*a/.test(a) || a === "--append") ? "edit" : "write"));
    else if (cmd === "touch" || cmd === "rm" || cmd === "unlink" || cmd === "truncate" || cmd === "shred")
      operands.forEach(o => add(o, "edit"));
    else if (["cp", "mv", "install", "ln", "rsync", "dd"].includes(cmd)) {
      if (cmd === "dd") args.filter(a => a.startsWith("of=")).forEach(a => add(a.slice(3)));
      else add(operands.at(-1));
    } else if ((cmd === "sed" || cmd === "perl" || cmd === "gsed") && args.some(a => /^-[a-zA-Z]*i/.test(a))) {
      // sed [-i ''|-i.bak|-i] [-e script ...|script] file...; perl -pi -e script file...
      let scriptSkipped = false, prev = "";
      for (const a of args) {
        const p = prev; prev = a;
        if (a.startsWith("-")) continue;
        if (p === "-e" || p === "-f" || p === "--expression" || p === "--file") { scriptSkipped = true; continue; }
        if (p === "-i" && cmd !== "perl" && (a === "''" || a === '""')) continue; // BSD sed empty backup suffix
        if (!scriptSkipped && !args.some(x => x === "-e" || x === "-f")) { scriptSkipped = true; continue; }
        add(a, "edit");
      }
    }
  }

  // Inline scripts (node -e, python -c, heredoc-fed interpreters): the full text, bodies included.
  for (const m of command.matchAll(/\b(writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|rmSync|unlinkSync|truncateSync)\s*\(\s*(['"`])([^'"`\n]+)\2/g))
    add(m[3], /^(?:writeFileSync|writeFile|createWriteStream)$/.test(m[1]!) ? "write" : "edit");
  for (const m of command.matchAll(/\bopenSync\s*\(\s*(['"`])([^'"`\n]+)\1\s*,\s*(['"`])[^'"`]*[wa+][^'"`]*\3/g)) add(m[2]);
  for (const m of command.matchAll(/\b(?:copyFileSync|renameSync|cpSync|copyFile|rename)\s*\(\s*(['"`])[^'"`\n]+\1\s*,\s*(['"`])([^'"`\n]+)\2/g)) add(m[3]);
  for (const m of command.matchAll(/\bopen\(\s*(['"])([^'"\n]+)\1\s*,\s*(['"])[^'"]*[wax+][^'"]*\3/g)) add(m[2]);
  for (const m of command.matchAll(/\bPath\(\s*(['"])([^'"\n]+)\1\s*\)\s*\.(?:write_text|write_bytes|unlink|touch)\b/g)) add(m[2]);
  // Unified diffs fed to patch / git apply.
  for (const m of command.matchAll(/^\+\+\+ (?:[ab]\/)?(\S+)/gm)) if (m[1] !== "/dev/null") add(m[1], "edit");
  for (const m of command.matchAll(/^diff --git a\/\S+ b\/(\S+)/gm)) add(m[1], "edit");
  return [...modes].map(([path, m]) => ({ path, mode: m }));
}

/**
 * Only a literal, single-command, single-destination, quoted cat heredoc is
 * a reliable pre-mutation source proposal. Dynamic shell writes remain UNKNOWN
 * and are caught by post-tool repository observation when possible.
 */
export function shellStaticWriteContents(command: string): ReadonlyMap<string, string> {
  const proposals = new Map<string, string>();
  const ambiguous = new Set<string>();
  const lines = command.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]!;
    if (!/^\s*cat\b/.test(header) || /[;&|$`]/.test(header) || />>/.test(header)) continue;
    const heredoc = header.match(/<<(-?)\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2/);
    const target = header.match(/(?:^|\s)>\s*('[^']+'|"[^"]+"|[^\s<>;&|]+)/);
    if (!heredoc || !target) continue; // unquoted delimiters may expand variables
    const remainder = header.replace(heredoc[0], "").replace(target[0], "").trim();
    if (remainder !== "cat") continue;
    const path = target[1]!.replace(/^['"]|['"]$/g, "");
    if (!PATHISH.test(path) || path.includes("..") || !path) continue;
    const body: string[] = [];
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const line = heredoc[1] === "-" ? lines[j]!.replace(/^\t+/, "") : lines[j]!;
      if (line === heredoc[3]) { end = j; break; }
      body.push(line);
    }
    if (end < 0) continue; // unterminated heredoc is not a source proposal
    if (proposals.has(path)) ambiguous.add(path);
    else proposals.set(path, body.join("\n") + "\n");
    i = end;
  }
  for (const path of ambiguous) proposals.delete(path);
  return proposals;
}
