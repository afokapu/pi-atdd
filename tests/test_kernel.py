"""Adversarial contract tests for the existing ATDD YAML and independent verification."""
from __future__ import annotations

import json
from pathlib import Path
import shutil

import pytest

from pi_atdd.cli import main
from pi_atdd.graph import GraphError, load_catalog, read_selectors, validate_selectors, resolve, source_digest
from pi_atdd.verify import verify_pytest

FIXTURES = Path(__file__).parent / "fixtures"


def catalog(tmp_path: Path):
    root = tmp_path / "catalog"
    shutil.copytree(FIXTURES / "catalog", root)
    return root, load_catalog(
        [{"path": "catalog", "sha256": source_digest(root), "origin": "atdd-extensions@3aa141e"}],
        tmp_path,
    )


def selectors():
    return read_selectors(FIXTURES / "selectors.yaml")


def test_upstream_snapshot_preserves_rule_id_and_semantics(tmp_path):
    root, graph = catalog(tmp_path)
    assert set(graph.rules) == {
        "coder.security.missing-auth", "coder.refactor.nplus1", "coder.performance.perf",
    }
    assert graph.rules["coder.security.missing-auth"].status == "active"
    assert graph.rules["coder.security.missing-auth"].kind == "rule"
    assert graph.rules["coder.performance.perf"].kind == "principle"
    assert graph.provenance[0]["sha256"] == source_digest(root)


def test_mandatory_requires_closure_not_arbitrary_graph_traversal(tmp_path):
    _, graph = catalog(tmp_path)
    context = resolve(graph, selectors(), "avoid n+1 database queries", [], "task")
    assert context["status"] == "matched"
    assert context["matching_ids"] == [
        "coder.performance.perf", "coder.refactor.nplus1",
    ]
    assert "requires:coder.refactor.nplus1" in context["rules"][0]["reasons"]
    assert "coder.security.missing-auth" not in context["matching_ids"]


def test_relevant_edit_activates_rule_but_unrelated_edit_does_not(tmp_path):
    _, graph = catalog(tmp_path)
    ctx = resolve(graph, selectors(), "Add pagination", ["src/myapp/routes/users.py"], "edit")
    assert ctx["matching_ids"] == ["coder.security.missing-auth"]
    irrelevant = resolve(graph, selectors(), "Update readme", ["docs/readme.md"], "edit")
    assert irrelevant["status"] == "unresolved"
    assert irrelevant["unresolved_paths"] == ["docs/readme.md"]
    assert "NOT proof" in irrelevant["note"]


def test_source_hash_detects_unauthorized_convention_changes(tmp_path):
    root, _ = catalog(tmp_path)
    locked = source_digest(root)
    path = root / "conventions" / "coder.performance.perf.convention.yaml"
    path.write_text(path.read_text() + "\n# unauthorized change\n")
    with pytest.raises(GraphError, match="source drift"):
        load_catalog([{"path": "catalog", "sha256": locked}], tmp_path)


def test_duplicate_yaml_fields_fail_instead_of_overwriting(tmp_path):
    root, _ = catalog(tmp_path)
    path = root / "conventions" / "coder.performance.perf.convention.yaml"
    path.write_text(path.read_text() + "\nrule_id: shadow-rule\n")
    with pytest.raises(GraphError, match="duplicate YAML key"):
        load_catalog([{"path": "catalog", "sha256": source_digest(root)}], tmp_path)


def test_missing_graph_endpoint_fails_closed(tmp_path):
    root, _ = catalog(tmp_path)
    path = root / "relationships.yaml"
    path.write_text(path.read_text().replace(
        "target_ref: coder.performance.perf", "target_ref: coder.nonexistent"
    ))
    with pytest.raises(GraphError, match="unresolved edge endpoint"):
        load_catalog([{"path": "catalog", "sha256": source_digest(root)}], tmp_path)


def test_missing_selector_rule_does_not_silently_degrade(tmp_path):
    _, graph = catalog(tmp_path)
    with pytest.raises(GraphError, match="unknown convention"):
        resolve(graph, [{"id": "broken", "always": True, "rules": ["invented.rule"]}], "", [])


def test_limit_is_explicit_and_does_not_hide_full_selection(tmp_path):
    _, graph = catalog(tmp_path)
    ctx = resolve(graph, selectors(), "database queries", [], limit=1)
    assert ctx["truncated"] is True
    assert len(ctx["rules"]) == 1
    assert len(ctx["matching_ids"]) == 2


def test_pytest_executes_only_selected_case(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_payments.py").write_text(
        "def test_selected():\n    assert 2 + 2 == 4\n\n"
        "def test_not_selected():\n    assert False, 'must not run'\n"
    )
    result = verify_pytest(tmp_path, ["tests/test_payments.py::test_selected"])
    assert result["status"] == "passed", result
    fail = verify_pytest(tmp_path, ["tests/test_payments.py::test_not_selected"])
    assert fail["status"] == "failed"
    assert fail["exit_code"] != 0


@pytest.mark.parametrize("target", [
    "../outside.py", "/tmp/outside.py", "-k", "tests/missing.py", "tests/test.py::-k",
])
def test_pytest_rejects_unsafe_or_missing_targets(tmp_path, target):
    with pytest.raises(ValueError):
        verify_pytest(tmp_path, [target])


def test_cli_requires_source_lock_and_reports_context(tmp_path, capsys):
    root, _ = catalog(tmp_path)
    shutil.copy2(FIXTURES / "selectors.yaml", tmp_path / "selectors.yaml")
    (tmp_path / "atdd-pi.yaml").write_text(
        "schema: pi-atdd/config/v1\nsources:\n"
        "  - path: catalog\n    sha256: " + source_digest(root) + "\n"
        "selectors: selectors.yaml\n"
    )
    code = main(["--repo", str(tmp_path), "context", "--task", "FastAPI endpoint"])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["matching_ids"] == ["coder.security.missing-auth"]
    code = main(["--repo", str(tmp_path), "context", "--task", "No triggers"])
    assert code == 3
    assert json.loads(capsys.readouterr().out)["status"] == "unresolved"


def test_no_pytest_target_means_no_implicit_full_suite(tmp_path):
    with pytest.raises(ValueError, match="explicit pytest targets"):
        verify_pytest(tmp_path, [])



def test_dormant_selector_typo_is_rejected_before_work(tmp_path):
    _, graph = catalog(tmp_path)
    # This selector would never activate on the current task, but must still fail.
    broken = selectors() + [{
        "id": "dormant-typo", "operations": ["edit"], "paths": ["not-used/**.py"],
        "rules": ["coder.nonexistent"],
    }]
    with pytest.raises(GraphError, match="unknown convention"):
        validate_selectors(graph, broken)


def test_invalid_activation_predicate_rejected(tmp_path):
    _, graph = catalog(tmp_path)
    with pytest.raises(GraphError, match="no activation predicate"):
        validate_selectors(graph, [{
            "id": "empty", "rules": ["coder.security.missing-auth"],
        }])
