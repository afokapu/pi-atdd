// ATD-20: pi-atdd is a versioned Pi package. Acceptance (release, local checks):
// 1 package.json is publishable (no "private": true) and carries a semver version;
// 2 CHANGELOG.md is in Pi's format (## [x.y.z] - YYYY-MM-DD) with a heading for that version,
//   newest first, so Pi's "Extension Updates" can read it;
// 3 the licence status of vendor/atdd-bun and vendor/atdd-flow is recorded in docs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const pkg = JSON.parse(read("package.json")) as { version: string; private?: boolean; files: string[] };
const changelog = existsSync(resolve(root, "CHANGELOG.md")) ? read("CHANGELOG.md") : "";
const headings = [...changelog.matchAll(/^## (.*)$/gm)].map(m => m[1]);

test("package.json is publishable and carries a semver version", () => {
  assert.equal(pkg.private, undefined, "remove \"private\": true so the package can be installed from git");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(pkg.files.includes("CHANGELOG.md"), "CHANGELOG.md ships with the package");
});

test("CHANGELOG.md has a Pi-format heading for the package.json version", () => {
  const heading = `[${pkg.version}] - `;
  assert.ok(
    headings.some(h => h.startsWith(heading)),
    `expected a "## [${pkg.version}] - YYYY-MM-DD" heading, found: ${headings.join(" | ")}`,
  );
});

test("every CHANGELOG heading is parseable by Pi and the versions run newest first", () => {
  const versions = headings.map(h => {
    const m = h.match(/^\[(\d+)\.(\d+)\.(\d+)\] - \d{4}-\d{2}-\d{2}$/);
    assert.ok(m, `heading is not "[x.y.z] - YYYY-MM-DD": ${h}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  });
  assert.ok(versions.length > 0);
  for (let i = 1; i < versions.length; i++) {
    const [a, b] = [versions[i - 1], versions[i]];
    const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    assert.ok(newer, `CHANGELOG headings must run newest first: ${headings[i - 1]} before ${headings[i]}`);
  }
});

test("the licence status of the vendored ATDD-Bun and ATDD-Flow content is recorded", () => {
  const doc = resolve(root, `docs/RELEASE-${pkg.version}.md`);
  assert.ok(existsSync(doc), `docs/RELEASE-${pkg.version}.md must record the release and licence check`);
  const text = readFileSync(doc, "utf8");
  assert.match(text, /^## Licences$/m);
  const section = text.split(/^## Licences$/m)[1]?.split(/^## /m)[0] ?? "";
  assert.match(section, /atdd-bun/i, "licence section names vendor/atdd-bun");
  assert.match(section, /atdd-flow/i, "licence section names vendor/atdd-flow");
  assert.match(section, /5945d97/, "licence section pins the atdd-bun revision it checked");
  assert.match(section, /2a66019/, "licence section pins the atdd-flow revision it checked");
});

test("vendor/atdd-flow ships the MIT licence notice of its upstream", () => {
  const path = resolve(root, "vendor/atdd-flow/LICENSE");
  assert.ok(existsSync(path), "vendor/atdd-flow/LICENSE is required by the MIT licence (notice must travel with copies)");
  const text = readFileSync(path, "utf8");
  assert.match(text, /^MIT License$/m);
  assert.match(text, /Copyright \(c\) 2026 Alec Fokapu/);
});
