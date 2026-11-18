"""Targeted Python acceptance checks: explicit targets, no shell, bounded evidence."""
from __future__ import annotations

from pathlib import Path
import subprocess
import sys


def _target(repo: Path, value: str) -> str:
    if not value or value.startswith("-") or "\x00" in value:
        raise ValueError("pytest target must be a non-option path")
    file_part, _, node_id = value.partition("::")
    if not file_part.endswith(".py") or file_part.startswith("/"):
        raise ValueError(f"pytest target must be a repository-relative .py file: {value!r}")
    file = (repo / file_part).resolve()
    if file != repo and repo not in file.parents:
        raise ValueError(f"pytest target escapes repository: {value!r}")
    if not file.is_file():
        raise ValueError(f"pytest target does not exist: {value!r}")
    if "::" in value and (not node_id or node_id.startswith("-")):
        raise ValueError(f"invalid pytest node selector: {value!r}")
    return str(file) + ("::" + node_id if node_id else "")


def verify_pytest(repo: Path, targets: list[str], timeout: int = 90) -> dict:
    repo = repo.resolve()
    if not targets:
        raise ValueError("explicit pytest targets required; broad suites belong to the CI gate")
    if not 1 <= timeout <= 600:
        raise ValueError("pytest timeout must be 1–600 seconds")
    selected = [_target(repo, target) for target in targets]
    command = [sys.executable, "-m", "pytest", "-q", "--maxfail=1", *selected]
    try:
        completed = subprocess.run(
            command, cwd=repo, capture_output=True, text=True, timeout=timeout,
            check=False,
        )
        return {
            "status": "passed" if completed.returncode == 0 else "failed",
            "exit_code": completed.returncode,
            "targets": targets,
            "runner": "pytest",
            "stdout_tail": completed.stdout[-10000:],
            "stderr_tail": completed.stderr[-4000:],
            "timeout_seconds": timeout,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "status": "timed_out", "exit_code": None, "targets": targets,
            "runner": "pytest", "stdout_tail": str(exc.stdout or "")[-10000:],
            "stderr_tail": str(exc.stderr or "")[-4000:], "timeout_seconds": timeout,
        }
