"""Read existing ATDD convention YAML without rewriting upstream policy.

This is a *resolver*, not an authority to silently change policy disposition.
The source checksum prevents a catalog update from changing an ongoing task.
"""
from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
from hashlib import sha256
from pathlib import Path
import re
from typing import Any, Iterable

import yaml

EDGE_TYPES = {
    "requires", "blocks", "enables", "follows", "awaits", "triggered_by",
    "starts_with", "runs_alongside", "finishes_with", "relieves",
}
CONSTRAINTS = {"mandatory", "discretionary", "conditional"}


class GraphError(ValueError):
    """Invalid, incomplete, or ambiguously governed convention graph."""


class UniqueSafeLoader(yaml.SafeLoader):
    """Disallow YAML duplicate keys; PyYAML normally silently overwrites them."""


def _unique_mapping(loader: UniqueSafeLoader, node: yaml.MappingNode) -> dict:
    value: dict = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if not isinstance(key, (str, int, float, bool)):
            raise GraphError("YAML mapping keys must be scalar")
        if key in value:
            raise GraphError(f"duplicate YAML key {key!r}")
        value[key] = loader.construct_object(value_node, deep=True)
    return value


UniqueSafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _unique_mapping
)


def yaml_mapping(path: Path) -> dict[str, Any]:
    try:
        parsed = yaml.load(path.read_text("utf8"), Loader=UniqueSafeLoader)
    except (OSError, UnicodeError, yaml.YAMLError, GraphError) as exc:
        raise GraphError(f"{path}: {exc}") from exc
    if not isinstance(parsed, dict):
        raise GraphError(f"{path}: expected a YAML mapping")
    return parsed


def source_digest(root: Path) -> str:
    """Hash paths + content; not a Git ref label that could point elsewhere."""
    files = sorted(root.rglob("*.convention.yaml")) + sorted(root.rglob("relationships.yaml"))
    if not files:
        raise GraphError(f"{root}: no convention or relationship files")
    h = sha256()
    for file in sorted(files, key=lambda p: p.relative_to(root).as_posix()):
        if not file.is_file() or file.is_symlink():
            raise GraphError(f"{file}: source entry must be a regular non-symlink file")
        data = file.read_bytes()
        name = file.relative_to(root).as_posix().encode("utf8")
        h.update(len(name).to_bytes(8, "big"))
        h.update(name)
        h.update(len(data).to_bytes(8, "big"))
        h.update(data)
    return h.hexdigest()


@dataclass(frozen=True)
class Rule:
    id: str
    path: str
    statement: str
    summary: str
    fix_hint: str
    kind: str
    status: str
    disposition: str | null


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    type: str
    constraint: str
    reason: str


@dataclass
class Catalog:
    rules: dict[str, Rule]
    edges: list[Edge]
    provenance: list[dict[str, str]]


def load_catalog(sources: Iterable[dict[str, str]], repo: Path) -> Catalog:
    rules: dict[str, Rule] = {}
    edges: list[Edge] = []
    provenance: list[dict[str, str]] = []
    all_graph_nodes: set[str] = set()
    for src in sources:
        if not isinstance(src, dict) or not isinstance(src.get("path"), str):
            raise GraphError("each source needs a local path")
        root = (repo / src["path"]).resolve()
        if not root.is_dir():
            raise GraphError(f"convention source missing: {root}")
        digest = source_digest(root)
        expected = src.get("sha256")
        if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise GraphError(f"{root}: source must declare an exact sha256 lock")
        if expected != digest:
            raise GraphError(f"{root}: convention source drift: expected {expected}, found {digest}")
        origin = src.get("origin") or root.as_posix()
        provenance.append({"origin": origin, "sha256": digest, "path": root.as_posix()})
        convention_files = sorted(root.rglob("*.convention.yaml"))
        if not convention_files:
            raise GraphError(f"{root}: no convention nodes")
        local_nodes: set[str] = set()
        for file in convention_files:
            entry = yaml_mapping(file)
            id_ = entry.get("rule_id")
            if not isinstance(id_, str) or not id_.strip():
                raise GraphError(f"{file}: missing rule_id")
            if id_ in rules:
                raise GraphError(f"{file}: duplicate rule_id {id_} (previously {rules[id_].path})")
            body = entry.get("content") if isinstance(entry.get("content"), dict) else {}
            metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
            disposition = metadata.get("disposition")
            if disposition is not None and disposition not in {"strict", "advisory", "suppress-and-clean", "documentation-only"}:
                raise GraphError(f"{file}: unknown convention treatment {disposition!r}")
            rules[id_] = Rule(
                id=id_, path=f"{origin}/{file.relative_to(root).as_posix()}",
                statement=str(entry.get("statement") or ""),
                summary=str(body.get("summary") or ""),
                fix_hint=str(body.get("fix_hint") or ""),
                kind=str(entry.get("kind") or "rule"),
                status=str(entry.get("status") or "active"),
                disposition=disposition,
            )
            local_nodes.add(id_)
        graph_file = root / "relationships.yaml"
        if not graph_file.exists():
            raise GraphError(f"{root}: relationships.yaml is missing")
        graph = yaml_mapping(graph_file)
        names = graph.get("nodes")
        pairs = graph.get("edges")
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise GraphError(f"{graph_file}: nodes must be a string array")
        if len(names) != len(set(names)) or set(names) != local_nodes:
            raise GraphError(f"{graph_file}: node registry differs from convention files: missing {sorted(local_nodes - set(names))}; unknown {sorted(set(names) - local_nodes)}")
        if not isinstance(pairs, list):
            raise GraphError(f"{graph_file}: edges must be an array")
        all_graph_nodes.update(local_nodes)
        for item in pairs:
            if not isinstance(item, dict):
                raise GraphError(f"{graph_file}: edge must be an object")
            a, b, kind = item.get("source_ref"), item.get("target_ref"), item.get("type")
            if not all(isinstance(n, str) and n for n in (a, b, kind)):
                raise GraphError(f"{graph_file}: edge lacks source_ref, target_ref or type")
            if kind not in EDGE_TYPES:
                raise GraphError(f"{graph_file}: unsupported edge type {kind!r}")
            constraint = item.get("constraint", "mandatory")
            if constraint not in CONSTRAINTS:
                raise GraphError(f"{graph_file}: bad constraint {constraint!r}")
            edges.append(Edge(a, b, kind, constraint, str(item.get("reason") or "")))
    for edge in edges:
        for endpoint in (edge.source, edge.target):
            if endpoint not in rules:
                raise GraphError(f"unresolved edge endpoint {endpoint!r} ({edge.source} -{edge.type}-> {edge.target}); load its source explicitly")
    return Catalog(rules, edges, provenance)


def _match_selector(selector: dict, task: str, paths: list[str], operation: str) -> tuple[bool, list[str]]:
    operations = selector.get("operations", [])
    if not isinstance(operations, list) or not all(isinstance(x, str) for x in operations):
        raise GraphError(f"selector {selector.get('id')}: operations must be an array of strings")
    if operations and operation not in operations:
        return False, []
    globs = selector.get("paths", [])
    terms = selector.get("terms", [])
    if not isinstance(globs, list) or not isinstance(terms, list):
        raise GraphError(f"selector {selector.get('id')}: paths and terms must be arrays")
    if not all(isinstance(g, str) for g in globs + terms):
        raise GraphError(f"selector {selector.get('id')}: paths and terms must be strings")
    evidence = [f"path:{p}" for p in paths if any(fnmatchcase(p, g) for g in globs)]
    evidence += [f"term:{t}" for t in terms if t.casefold() in task.casefold()]
    if selector.get("always") is True:
        evidence.append("always")
    return bool(evidence), evidence


def resolve(catalog: Catalog, selectors: list[dict], task: str, paths: list[str],
            operation: str = "task", limit: int = 16) -> dict[str, Any]:
    """Select only documented applicability, then close mandatory 'requires' edges.

    'blocks' is an ordering relation in ATDD, NOT automatically a policy conflict.
    The resolver never infers an enforcement tier from YAML kind or severity.
    """
    seeds: dict[str, list[str]] = {}
    for selector in selectors:
        if not isinstance(selector, dict) or not isinstance(selector.get("id"), str):
            raise GraphError("selectors require unique string IDs")
        applies, evidence = _match_selector(selector, task, paths, operation)
        if not applies:
            continue
        ids = selector.get("rules")
        if not isinstance(ids, list) or not ids:
            raise GraphError(f"selector {selector['id']}: rules must be nonempty")
        for id_ in ids:
            if id_ not in catalog.rules:
                raise GraphError(f"selector {selector['id']}: unknown convention {id_!r}")
            if catalog.rules[id_].status != "active":
                raise GraphError(f"selector {selector['id']}: inactive convention {id_!r}")
            seeds.setdefault(id_, []).extend(f"{selector['id']}:{e}" for e in evidence)
    selected = set(seeds)
    reasons = {id_: list(dict.fromkeys(v)) for id_, v in seeds.items()}
    # Only the precise 'requires' relation implies a prerequisite. Co-occurrence,
    # ordering and 'blocks' relations do not automatically select rules.
    pending = list(sorted(selected))
    while pending:
        origin = pending.pop()
        for edge in catalog.edges:
            if edge.source != origin or edge.type != "requires" or edge.constraint != "mandatory":
                continue
            target = edge.target
            if target not in selected:
                selected.add(target)
                pending.append(target)
            reasons.setdefault(target, []).append(f"requires:{origin}")
    rules_sorted = sorted(selected)
    shown = rules_sorted[:limit]
    status = "matched" if selected else "unresolved"
    return {
        "status": status,
        "operation": operation,
        "rules": [
            {"id": id_, "path": catalog.rules[id_].path, "statement": catalog.rules[id_].statement,
             "summary": catalog.rules[id_].summary,
             "fix_hint": catalog.rules[id_].fix_hint[:1200],
             "reasons": sorted(set(reasons[id_])), "kind": catalog.rules[id_].kind,
             "disposition": catalog.rules[id_].disposition}
            for id_ in shown
        ],
        "matching_ids": rules_sorted,
        "truncated": len(rules_sorted) > limit,
        "unresolved_paths": paths if not selected else [],
        "provenance": catalog.provenance,
        "note": (
            "No selector matched; this is an applicability coverage gap, NOT proof that no rules apply."
            if not selected else
            "Selected conventions are guidance; this command does not decide compliance or waive invariants."
        ),
    }


def validate_selectors(catalog: Catalog, selectors: list[dict]) -> None:
    """Audit every selector up front, not only those activated by today's task."""
    if not isinstance(selectors, list):
        raise GraphError("selector registry must be an array")
    found: set[str] = set()
    for item in selectors:
        if not isinstance(item, dict):
            raise GraphError("selector must be a mapping")
        id_ = item.get("id")
        if not isinstance(id_, str) or not id_ or id_ in found:
            raise GraphError(f"selector ID missing or duplicated: {id_!r}")
        found.add(id_)
        rules = item.get("rules")
        if not isinstance(rules, list) or not rules or not all(isinstance(r, str) for r in rules):
            raise GraphError(f"selector {id_}: rules must be nonempty string IDs")
        for rule in rules:
            if rule not in catalog.rules:
                raise GraphError(f"selector {id_}: unknown convention {rule!r}")
            if catalog.rules[rule].status != "active":
                raise GraphError(f"selector {id_}: inactive convention {rule!r}")
        for field in ("paths", "terms", "operations"):
            values = item.get(field, [])
            if not isinstance(values, list) or not all(isinstance(v, str) and v for v in values):
                raise GraphError(f"selector {id_}: {field} must be an array of nonempty strings")
        if not any((item.get("paths"), item.get("terms"), item.get("always") is True)):
            raise GraphError(f"selector {id_}: no activation predicate")
        if item.get("always", False) not in (False, True):
            raise GraphError(f"selector {id_}: always must be boolean")


def read_selectors(path: Path) -> list[dict]:
    payload = yaml_mapping(path)
    if payload.get("schema") != "pi-atdd/selectors/v1":
        raise GraphError(f"{path}: unsupported selector schema")
    items = payload.get("selectors")
    if not isinstance(items, list):
        raise GraphError(f"{path}: selectors must be an array")
    ids = [item.get("id") for item in items if isinstance(item, dict)]
    if len(ids) != len(items) or len(ids) != len(set(ids)):
        raise GraphError(f"{path}: selector IDs must be unique")
    return items
