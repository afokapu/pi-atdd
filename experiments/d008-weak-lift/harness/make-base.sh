#!/usr/bin/env bash
# Create the ONE immutable base revision for all PLT-79 weak-lift trials, plus a frozen
# snapshot of the pi-atdd extension at the experiment's pi-atdd revision.
# Usage: make-base.sh <evidenceRoot> <pi-atdd-revision>
set -euo pipefail
E="$1"; PI_ATDD_REV="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"
export JJ_USER="D008 evaluator" JJ_EMAIL="d008-evaluator@example.invalid" JJ_PAGER=cat JJ_EDITOR=true
BASE="$E/base/repo"
if [ -e "$BASE" ]; then echo "base already exists; refusing to recreate an immutable base" >&2; exit 3; fi
mkdir -p "$BASE"
cp -R "$REPO/experiments/d008-weak-lift/fixture/." "$BASE/"
cd "$BASE"
jj git init --colocate >/dev/null 2>&1
jj commit -m "fixture: PLT-79 D008 weak-lift orders-service base (T1-SEC, T2-ARCH, T3-TRUTH, T5-SEC, T6-ARCH, T7-TRUTH)" >/dev/null 2>&1
jj bookmark create base -r @- >/dev/null 2>&1
jj log -r base --no-graph -T 'commit_id ++ "\n"' > "$E/base/BASE_SHA"
# Frozen extension snapshot (read-only git archive of the pi-atdd revision under test).
SNAP="$E/pi-atdd-extension-snapshot"
mkdir -p "$SNAP"
git -C "$REPO" archive "$PI_ATDD_REV" | tar -x -C "$SNAP"
ln -s "$REPO/node_modules" "$SNAP/node_modules"
git -C "$REPO" rev-parse "$PI_ATDD_REV^{tree}" > "$E/base/PI_ATDD_TREE"
git -C "$REPO" rev-parse "$PI_ATDD_REV" > "$E/base/PI_ATDD_COMMIT"
cat "$E/base/BASE_SHA"
