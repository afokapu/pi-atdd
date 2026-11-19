#!/usr/bin/env python3
"""PLT-87: mechanical old -> new convention id map (<profile>.<area>.<rule>).

Reads every canonical convention under a catalog root, derives the
profile-first id with the rules below, checks the map is one-to-one in both
directions and writes conventions/aliases.json. Run from the repository root
against the v0.2.0 layout (move.py runs it before relocating files):

    python3 tools/profile-naming/map.py [--catalog-root DIR] [--out FILE]

Rules (PLT-87 "Naming rule"):
  * planner.<area>.<rule> already conforms and keeps its id;
    planner.journey.strategy.<x> (4 segments) -> planner.journey.strategy-<x>.
  * coder.{bun,htmx}.<a>-<rest> / tester.{bun,htmx}.<a>-<rest> -> <profile>.<a>.<rest>:
    the stack segment is dropped and the first word of the rule becomes the area
    (compound areas below); htmx verbs/swaps/fragments share the area `hypermedia`
    and keep their full rule name.
  * atdd-bun.planner.* -> planner.integrity.* (all are plan-integrity validators).
  * atdd-bun.review.* -> reviewer.*; atdd-workflow.* / atdd-flow.* -> coach.*.
  * atdd-bun.topology.*, atdd-bun.profiles, traceability.* -> shared.* or tester.*
    per content (EXPLICIT table, each with a one-line reason; reported as ambiguous).
"""
import argparse, glob, hashlib, json, os, re

ID_RE = re.compile(r"^(planner|tester|coder|reviewer|coach|shared)\.[a-z0-9-]+\.[a-z0-9-]+$")
COMPOUND_AREAS = ["green-header", "green-urn", "dead-code", "error-response", "station-master"]
HYPERMEDIA = ("fragment", "swap", "verb")
# Rule names whose first word is not a noun area: the area is named, the full rule name is kept.
AREA_OF = {
    "tester.htmx.covered-train-is-routed": "e2e",
    "tester.htmx.exposed-journey-e2e-coverage": "e2e",
    "tester.htmx.train-e2e-coverage": "e2e",
    "tester.htmx.presentation-smoke-coverage": "smoke",
}
# coder.bun.design-* mixes module architecture and UI design-system rules, and upstream external
# core ids `coder.design.<x>` are edge targets in relationships.yaml (the Bun rule requires the core
# it mirrors). Splitting by content keeps every new id distinct from those external refs.
DESIGN_AREA = {
    "connected": "architecture", "dependency-flow": "architecture", "hierarchy-import": "architecture",
    "orphan-export": "architecture", "wagons-import": "architecture",
    "primitives": "ui", "token-color": "ui", "token-hardcoded": "ui", "tokens-pure": "ui",
}

# Content-based placements (PLT-87 outliers). A reason marks the choice as ambiguous for the owner.
EXPLICIT = {
    "atdd-bun.review.behavioral-reconciliation": ("reviewer.reconciliation.behavioral", None),
    "atdd-bun.review.owner-inspectability": ("reviewer.inspectability.owner", None),
    "atdd-workflow.workflow.lifecycle": ("coach.workflow.lifecycle", None),
    "atdd-flow.collaboration": ("coach.collaboration.accountable-delegation",
        "Flow policy has a 2-segment id; the rule segment is taken from its name ('durable accountable delegation')"),
    "atdd-bun.profiles.presets": ("shared.profiles.presets",
        "the agent proposes which profile presets to activate, whichever profile is running; shared (could be coach)"),
    "atdd-bun.topology.plan-location": ("shared.topology.plan-location",
        "plan paths are written by the planner but read by every profile and validator; shared (could be planner)"),
    "atdd-bun.topology.source-location": ("shared.topology.source-location",
        "source path + component URN: the coder writes it, the tester binds to it; shared (could be coder)"),
    "atdd-bun.topology.feature-source-coverage": ("shared.topology.feature-source-coverage",
        "cross-artifact closure from plan WMBTs to source; shared (could be coder)"),
    "atdd-bun.topology.test-location": ("tester.topology.test-location",
        "test path, test URN and acceptance binding are tester-authored files"),
    "atdd-bun.topology.e2e-location": ("tester.topology.e2e-location",
        "e2e route/journey test paths are tester-authored files"),
    "atdd-bun.topology.feature-test-coverage": ("tester.topology.feature-test-coverage",
        "a feature with WMBTs has a bound test: tester obligation (could be a shared closure)"),
    "traceability.plan.executable-acceptance-has-test": ("tester.traceability.plan-executable-acceptance-has-test",
        "acceptance -> test binding; the profile design gives traceability.* to the Tester"),
    "traceability.test.binding-resolves": ("tester.traceability.test-binding-resolves",
        "a test names a resolvable acceptance/WMBT/train; tester-authored"),
    "traceability.source.tested-by-present": ("shared.traceability.source-tested-by-present",
        "owner decision 2026-11-19: shared, because the coder writes the source witness header and the tester owns closure"),
    "traceability.source.tested-by-resolves": ("shared.traceability.source-tested-by-resolves",
        "owner decision 2026-11-19: shared, same split as tested-by-present"),
}


def derive(old):
    if old in EXPLICIT:
        return EXPLICIT[old]
    parts = old.split(".")
    if parts[0] == "planner" and len(parts) == 3:
        return old, None
    if parts[:3] == ["planner", "journey", "strategy"] and len(parts) == 4:
        return "planner.journey.strategy-" + parts[3], None
    if parts[:2] == ["atdd-bun", "planner"] and len(parts) == 3:
        return "planner.integrity." + parts[2], None
    if parts[0] in ("coder", "tester") and parts[1] in ("bun", "htmx") and len(parts) == 3:
        rule = parts[2]
        if parts[:2] == ["coder", "bun"] and rule.startswith("design-"):
            return "coder." + DESIGN_AREA[rule[len("design-"):]] + "." + rule[len("design-"):], None
        if old in AREA_OF:
            return parts[0] + "." + AREA_OF[old] + "." + rule, None
        if parts[1] == "htmx" and rule.split("-")[0] in HYPERMEDIA:
            return parts[0] + ".hypermedia." + rule, None
        for area in COMPOUND_AREAS:
            if rule.startswith(area + "-"):
                return parts[0] + "." + area + "." + rule[len(area) + 1:], None
        area, _, rest = rule.partition("-")
        if not rest:
            raise SystemExit("cannot split rule name: " + old)
        return parts[0] + "." + area + "." + rest, None
    raise SystemExit("no naming rule for " + old)


def build(catalog_root):
    rows = []
    for f in sorted(glob.glob(os.path.join(catalog_root, "**/*.convention.yaml"), recursive=True)):
        text = open(f, encoding="utf-8").read()
        m = re.search(r"^rule_id:\s*(\S+)\s*$", text, re.M)
        if not m:
            raise SystemExit("no rule_id: " + f)
        old = m.group(1)
        new, reason = derive(old)
        if not ID_RE.match(new):
            raise SystemExit("bad id " + new + " from " + old)
        rows.append((old, new, reason, f))
    forward = {o: n for o, n, _, _ in rows}
    # A new id must never coincide with an external (unshipped) id the graph references.
    graph = os.path.join(catalog_root, "atdd-bun", "relationships.yaml")
    if os.path.exists(graph):
        refs = set(re.findall(r"^\s*(?:-\s+)?(?:source_ref|target_ref):\s+(\S+)\s*$", open(graph).read(), re.M))
        hit = sorted(n for o, n in forward.items() if n != o and n in refs and n not in forward)
        if hit:
            raise SystemExit("new ids collide with external graph refs: " + ", ".join(hit))
    backward = {}
    for o, n in forward.items():
        if n in backward:
            raise SystemExit("collision: " + n + " <- " + backward[n] + ", " + o)
        backward[n] = o
    assert len(forward) == len(backward) == len(rows), "map is not one-to-one"
    assert all(forward[backward[n]] == n for n in backward) and all(backward[forward[o]] == o for o in forward)
    return rows, forward


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog-root", default="vendor")
    ap.add_argument("--out", default="conventions/aliases.json")
    a = ap.parse_args()
    rows, forward = build(a.catalog_root)
    out = {
        "schema": "pi-atdd/convention-aliases/v1",
        "issue": "PLT-87",
        "rule": "<profile>.<area>.<rule>, profile in planner|tester|coder|reviewer|coach|shared; "
                "file conventions/<profile>/<area>/<id>.convention.yaml under each source root",
        "count": len(forward),
        "aliases": dict(sorted(forward.items())),
        "ambiguous": {o: {"id": forward[o], "reason": r} for o, _, r, _ in sorted(rows) if r},
    }
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    body = json.dumps(out, indent=2) + "\n"
    open(a.out, "w", encoding="utf-8").write(body)
    print(a.out, len(forward), "ids,", sum(o != n for o, n in forward.items()), "renamed, sha256",
          hashlib.sha256(body.encode()).hexdigest())


if __name__ == "__main__":
    main()
