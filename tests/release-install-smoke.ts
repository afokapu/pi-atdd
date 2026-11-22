// URN: test:pi-atdd:release:ATD-20-ACC-1
// Acceptance: acc:pi-atdd:ATD-20-ACC-1
// Proves ATD-20 acceptance 1 with real Pi in an isolated PI_CODING_AGENT_DIR: a clean profile installs a
// tagged git source, the extension loads and /atdd is registered.
// Acceptance 2 (a pin bump shows "Extension Updates") is PENDING and NOT proven here. This file only asserts
// that Pi stays silent after a plain bump (Pi 1.5.2 keys notices by source incl. @ref).
// The git source is the spec a profile would use (git:github.com/afokapu/pi-atdd@vX.Y.Z). GitHub is
// redirected to a local bare-style copy of HEAD with a git URL rewrite in an isolated gitconfig. Tags
// are local to that copy. Nothing is pushed, and no profile or real Pi settings file is read or written.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(process.cwd());
const cli = resolve(repo, "node_modules/.bin/pi");
const realPiSettings = join(homedir(), ".pi", "agent", "settings.json");
const sha = (path: string) => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent");
const realBefore = sha(realPiSettings);

const run = (cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: Buffer | string } = {}) =>
  spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env, input: opts.input, encoding: "utf8", maxBuffer: 50_000_000, timeout: 240_000 });

function fail(message: string): never {
  throw new Error(message);
}

function bumpPatch(version: string) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// Interactive Pi needs a TTY (the "Extension Updates" notice is a TUI message). Python's stdlib pty
// supplies one; the child runs for a fixed time, then gets SIGTERM. Output is returned without ANSI codes.
const PTY_HELPER = `
import os, pty, select, signal, sys, time
cli, cwd, ms = sys.argv[1], sys.argv[2], float(sys.argv[3])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execv(cli, [cli] + sys.argv[4:])
out, end = b'', time.time() + ms / 1000
while time.time() < end:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
try:
    os.kill(pid, signal.SIGTERM)
except OSError:
    pass
sys.stdout.buffer.write(out)
`;
function interactiveStart(env: NodeJS.ProcessEnv, cwd: string, ms: number): string {
  const r = spawnSync("python3", ["-I", "-c", PTY_HELPER, cli, cwd, String(ms), "--offline", "--approve", "--no-session"], {
    env, encoding: "utf8", maxBuffer: 50_000_000, timeout: ms + 30_000,
  });
  if (r.error) fail("could not start interactive Pi under a pty: " + r.error.message);
  return (r.stdout ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

// RPC mode: ask Pi which commands are registered, exactly as the install smoke does.
function rpcCommands(env: NodeJS.ProcessEnv, cwd: string): Promise<Array<{ name: string; source?: unknown }>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cli, ["--offline", "--approve", "--mode", "rpc", "--no-session"], {
      cwd, env, stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("timed out waiting for get_commands")); }, 60_000);
    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString();
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg: { id?: string; success?: boolean; data?: { commands?: Array<{ name: string; source?: unknown }> } };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== "commands") continue;
        clearTimeout(timer);
        child.stdin.end();
        child.kill("SIGTERM");
        if (msg.success !== true) reject(new Error("get_commands failed: " + line));
        else resolvePromise(msg.data?.commands ?? []);
      }
    });
    child.stdin.write(JSON.stringify({ id: "commands", type: "get_commands" }) + "\n");
  });
}

async function main() {
  // Preconditions on the release itself. These fail until the release commit exists.
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { name: string; version: string; private?: boolean };
  if (pkg.private !== undefined) fail('package.json still has "private"; the package cannot be installed from git as published');
  const changelog = existsSync(join(repo, "CHANGELOG.md")) ? readFileSync(join(repo, "CHANGELOG.md"), "utf8") : "";
  if (!new RegExp(`^## \\[${pkg.version.replace(/\./g, "\\.")}\\] - `, "m").test(changelog)) fail(`CHANGELOG.md has no "## [${pkg.version}] - date" heading`);

  const root = mkdtempSync(join(tmpdir(), "pi-atdd-release-smoke-"));
  try {
    const home = join(root, "home"), project = join(root, "project"), agent = join(root, "agent");
    const remote = join(root, "remotes", "pi-atdd"), gitconfig = join(root, "gitconfig");
    for (const d of [home, project, agent, join(root, "remotes")]) mkdirSync(d, { recursive: true });

    // 1. Local git source: a copy of the committed HEAD, with a tag for the release and a newer tag.
    const archive = spawnSync("git", ["-C", repo, "archive", "--format=tar", "HEAD"], { maxBuffer: 200_000_000 });
    if (archive.status !== 0) fail("git archive HEAD failed: " + archive.stderr);
    mkdirSync(remote);
    const untar = spawnSync("tar", ["-x", "-C", remote], { input: archive.stdout });
    if (untar.status !== 0) fail("untar failed");
    const git = (args: string[]) => {
      const r = run("git", ["-c", "user.name=pi-atdd smoke", "-c", "user.email=smoke@invalid", "-C", remote, ...args]);
      if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${r.stderr}`);
      return r.stdout;
    };
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", `pi-atdd ${pkg.version} release snapshot`]);
    git(["tag", `v${pkg.version}`]);

    const next = bumpPatch(pkg.version);
    const pkgNext = JSON.parse(readFileSync(join(remote, "package.json"), "utf8"));
    pkgNext.version = next;
    writeFileSync(join(remote, "package.json"), JSON.stringify(pkgNext, null, 2) + "\n");
    const sentinel = `ATD20-SMOKE-SENTINEL-${next}`;
    const today = new Date().toISOString().slice(0, 10);
    const cl = readFileSync(join(remote, "CHANGELOG.md"), "utf8");
    writeFileSync(join(remote, "CHANGELOG.md"), cl.replace(/^## /m, `## [${next}] - ${today}\n\n### Fixed\n\n- ${sentinel}: fixture entry for the ATD-20 pin-bump proof.\n\n## `));
    git(["add", "-A"]);
    git(["commit", "-q", "-m", `fixture ${next}`]);
    git(["tag", `v${next}`]);

    // 2. Redirect the GitHub spec to the local copy. Only this child environment sees it.
    writeFileSync(gitconfig, `[url "${pathToFileURL(remote).href}"]\n\tinsteadOf = https://github.com/afokapu/pi-atdd\n`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      PI_CODING_AGENT_DIR: agent,
      PI_TELEMETRY: "0",
      PI_SKIP_VERSION_CHECK: "1",
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const source = `git:github.com/afokapu/pi-atdd`;

    // Acceptance 1: clean profile installs the tagged source; /atdd registers.
    const installed = run(cli, ["install", `${source}@v${pkg.version}`], { cwd: project, env });
    if (installed.status !== 0) fail(`pi install ${source}@v${pkg.version} failed: ${installed.stdout}${installed.stderr}`);
    const commands = await rpcCommands(env, project);
    if (!commands.some(c => c.name === "atdd")) fail("installed package did not register /atdd");
    console.log(`A1 ok: clean profile installed ${source}@v${pkg.version}; /atdd registered`);

    // Settings written at the first interactive start (fresh install records the version silently).
    const first = interactiveStart(env, project, 12_000);
    if (/Extension Updates/.test(first)) fail("fresh install must not show Extension Updates");
    console.log("A2 setup ok: first start records the installed version without a notice");

    // Acceptance 2: bump the pin to the newer tag, reconcile, then start Pi.
    const bump = run(cli, ["install", `${source}@v${next}`], { cwd: project, env });
    if (bump.status !== 0) fail(`pin bump to v${next} failed: ${bump.stdout}${bump.stderr}`);
    const update = run(cli, ["update", "--extensions"], { cwd: project, env });
    if (update.status !== 0) fail(`pi update --extensions failed: ${update.stdout}${update.stderr}`);
    const settings = readFileSync(join(agent, "settings.json"), "utf8");
    if (!settings.includes(`@v${next}`) || settings.includes(`@v${pkg.version}"`)) fail("pin was not bumped to the newer tag");
    // Acceptance 2 is pending (Pi 1.5.2, source-info.js getSourcePackageKey = {source, scope}; source includes @ref):
    // a plain pin bump is a new key, so Pi treats it as a fresh install and stays silent. Asserted here so
    // that a change in Pi is noticed. No workaround is built.
    const plain = interactiveStart(env, project, 15_000);
    if (/Extension Updates/.test(plain)) fail("Pi now shows Extension Updates after a plain pin bump: update the ATD-20 finding in docs/RELEASE-0.4.0.md");
    console.log(`A2 pending: a plain pin bump v${pkg.version} -> v${next} shows no Extension Updates (Pi 1.5.2 keys notices by source incl. @ref); follow-up issue, no workaround`);


    if (sha(realPiSettings) !== realBefore) fail("the real Pi settings file changed");
    console.log("Release install smoke passed in an isolated PI_CODING_AGENT_DIR; no tag was pushed.");
  } finally {
    if (process.env.KEEP_SMOKE_ROOT) console.error("kept", root);
    else rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error("Release install smoke failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
