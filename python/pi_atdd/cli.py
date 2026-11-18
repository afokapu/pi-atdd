"""CLI consumed by Pi and by independent CI; JSON output is part of the contract."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .graph import GraphError, load_catalog, read_selectors, validate_selectors, resolve, source_digest, yaml_mapping
from .verify import verify_pytest


def _config(repo: Path, file: str) -> tuple[list[dict], Path]:
    config_path = (repo / file).resolve()
    if repo not in config_path.parents and config_path != repo:
        raise GraphError("configuration escapes repository")
    config = yaml_mapping(config_path)
    if config.get("schema") != "pi-atdd/config/v1":
        raise GraphError(f"{config_path}: unsupported configuration schema")
    sources = config.get("sources")
    if not isinstance(sources, list) or not sources:
        raise GraphError("configuration needs at least one pinned convention source")
    selector = config.get("selectors")
    if not isinstance(selector, str) or not selector:
        raise GraphError("configuration needs a selector registry path")
    return sources, (repo / selector).resolve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pi-atdd")
    parser.add_argument("--repo", default=".", help="repository root")
    parser.add_argument("--config", default="atdd-pi.yaml")
    sub = parser.add_subparsers(dest="command", required=True)

    lock = sub.add_parser("digest", help="print current content hash for a local source")
    lock.add_argument("source")

    context = sub.add_parser("context", help="retrieve applicable conventions")
    context.add_argument("--task", default="")
    context.add_argument("--path", action="append", default=[])
    context.add_argument("--operation", choices=["task", "create", "edit", "review"], default="task")
    context.add_argument("--limit", type=int, default=12)

    verify = sub.add_parser("verify", help="execute explicitly selected pytest cases")
    verify.add_argument("--target", action="append", required=True)
    verify.add_argument("--timeout", type=int, default=90)

    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    try:
        if not repo.is_dir():
            raise ValueError(f"repository does not exist: {repo}")
        if args.command == "digest":
            result = {"sha256": source_digest((repo / args.source).resolve()), "source": args.source}
        elif args.command == "verify":
            result = verify_pytest(repo, args.target, args.timeout)
        else:
            if not 1 <= args.limit <= 100:
                raise ValueError("limit must be 1 to 100")
            sources, selector_path = _config(repo, args.config)
            catalog = load_catalog(sources, repo)
            selectors = read_selectors(selector_path)
            validate_selectors(catalog, selectors)
            result = resolve(catalog, selectors, args.task, args.path, args.operation, args.limit)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        if args.command == "context" and result["status"] == "unresolved":
            return 3   # applicability gap, not a clean bill of health
        if args.command == "verify" and result["status"] != "passed":
            return 1
        return 0
    except (GraphError, ValueError, OSError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
