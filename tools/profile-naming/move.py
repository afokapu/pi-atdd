#!/usr/bin/env python3
"""PLT-87: relocate every canonical convention to the profile-first layout.

For each source root (vendor/atdd-bun, vendor/atdd-flow):
  * <root>/conventions/<family>/<old>.convention.yaml and
    <root>/planner-nodes/nodes/<old>.convention.yaml
    -> <root>/conventions/<profile>/<area>/<new>.convention.yaml
  * only the top-level `rule_id:` line changes; every other byte is kept;
  * relationships.yaml: `nodes` entries and `source_ref`/`target_ref` values that
    name a shipped convention are re-keyed (external refs are left as they are).
Writes conventions/provenance.json with the old and new path + SHA-256 of every
file, and checks that restoring the old rule_id reproduces the old bytes exactly.
Guard: refuses to run when planner-nodes/ is already gone.
"""
import hashlib, json, os, re, subprocess, sys

ROOTS = ["vendor/atdd-bun", "vendor/atdd-flow"]
ALIASES = "conventions/aliases.json"
RULE_ID = re.compile(r"^rule_id:[ \t]*(\S+)[ \t]*$", re.M)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    if not os.path.isdir("vendor/atdd-bun/planner-nodes"):
        sys.exit("already moved (vendor/atdd-bun/planner-nodes is gone)")
    subprocess.run([sys.executable, "tools/profile-naming/map.py", "--catalog-root", "vendor", "--out", ALIASES], check=True)
    aliases = json.load(open(ALIASES))["aliases"]
    records = []
    for root in ROOTS:
        sources = []
        for dirpath, _, names in os.walk(root):
            sources += [os.path.join(dirpath, n) for n in names if n.endswith(".convention.yaml")]
        staged = []
        for path in sorted(sources):
            raw = open(path, "rb").read()
            text = raw.decode("utf-8")
            assert len(RULE_ID.findall(text)) == 1, path
            m = RULE_ID.search(text)
            old = m.group(1)
            new = aliases[old]
            profile, area, _ = new.split(".")
            dest = os.path.join(root, "conventions", profile, area, new + ".convention.yaml")
            body = text[:m.start(1)] + new + text[m.end(1):]
            restored = body[:m.start(1)] + old + body[m.start(1) + len(new):]
            assert restored.encode("utf-8") == raw, "not byte-identical apart from rule_id: " + path
            staged.append((path, dest, body.encode("utf-8")))
            records.append({"old": old, "new": new, "oldPath": path, "newPath": dest,
                            "oldSha256": sha(raw), "newSha256": sha(body.encode("utf-8"))})
        for path, _, _ in staged:
            os.remove(path)
        for dirpath, _, _ in sorted(os.walk(root), key=lambda x: -len(x[0])):
            if not os.listdir(dirpath):
                os.rmdir(dirpath)
        for _, dest, body in staged:
            if os.path.exists(dest):
                sys.exit("destination exists: " + dest)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(body)
        graph = os.path.join(root, "relationships.yaml")
        if os.path.exists(graph):
            raw = open(graph, "rb").read()
            out, renamed = [], 0
            for line in raw.decode("utf-8").split("\n"):
                m = re.match(r"^(\s*-\s+|\s*(?:-\s+)?(?:source_ref|target_ref):\s+)(\S+)(\s*)$", line)
                if m and m.group(2) in aliases and aliases[m.group(2)] != m.group(2):
                    line = m.group(1) + aliases[m.group(2)] + m.group(3)
                    renamed += 1
                out.append(line)
            text = "\n".join(out).replace(
                "# Relationship graph for every convention this package ships (planner-nodes/ and conventions/).",
                "# Relationship graph for every convention this package ships (conventions/<profile>/<area>/).\n"
                "# PLT-87 re-keyed node ids to <profile>.<area>.<rule>; old ids resolve through conventions/aliases.json.")
            open(graph, "w", encoding="utf-8").write(text)
            records.append({"graph": graph, "oldSha256": sha(raw), "newSha256": sha(text.encode("utf-8")),
                            "refsRenamed": renamed})
    with open("conventions/provenance.json", "w") as fh:
        json.dump({"schema": "pi-atdd/convention-move-provenance/v1", "issue": "PLT-87",
                   "note": "restoring rule_id to `old` in newPath reproduces oldSha256 byte-for-byte",
                   "files": records}, fh, indent=2)
        fh.write("\n")
    print(sum(1 for r in records if "old" in r), "conventions moved;",
          [(r["graph"], r["refsRenamed"]) for r in records if "graph" in r])


if __name__ == "__main__":
    main()
