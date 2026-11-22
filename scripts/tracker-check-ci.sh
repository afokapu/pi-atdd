#!/usr/bin/env bash
# ATD-24: run `atdd tracker check` for a pull request.
# Exit codes follow the CLI: 0 pass, 1 fail, 3 notice (not checkable, e.g. no tracker configured).
# Inputs come from the environment so untrusted PR text is never interpolated into a shell command.
set -euo pipefail
base="${TRACKER_BASE_REF:?TRACKER_BASE_REF is required}"
head="${TRACKER_HEAD_REF:-HEAD}"
cli="${TRACKER_CLI:-src/cli.ts}"
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
printf '%s' "${TRACKER_PR_BODY-}" > "$body_file"

args=()
while IFS= read -r f; do
  [ -n "$f" ] && args+=(--changed "$f")
done < <(git diff --name-only "$(git merge-base "$base" "$head")" "$head")
if [ "${#args[@]}" -eq 0 ]; then
  echo '{"status":"pass","note":"no changed files"}'
  exit 0
fi

set +e
node --experimental-strip-types "$cli" tracker check "${args[@]}" \
  --branch "${TRACKER_BRANCH-}" --pr-body-file "$body_file"
code=$?
set -e
case "$code" in
  0) echo "tracker check: pass" ;;
  1) echo "tracker check: fail (code change without a tracker issue id in branch and PR body)" ;;
  3) echo "tracker check: notice (no tracker configured or not checkable; this is NOT a pass)" ;;
  *) echo "tracker check: error (exit $code)" ;;
esac
exit "$code"
