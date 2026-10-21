#!/usr/bin/env bash
# Usage: incremental-report.sh <cache-dir> <summary.json>...
# Writes the step summary, then drops every global key but the current one per project and the
# per-run work dir, so the saved cache holds only results that can still hit.
set -uo pipefail
cache=$1
shift
summaries=()
for file in "$@"; do [ -f "$file" ] && summaries+=("$file"); done
[ ${#summaries[@]} -eq 0 ] && exit 0
all=$(jq -s '[.[] | if type == "array" then .[] else . end]' "${summaries[@]}")
{
  echo "### Tests (incremental)"
  echo
  echo "| project | files | reused | executed | failed | recorded | seconds |"
  echo "|---|---|---|---|---|---|---|"
  jq -r '.[] | "| \(.project) | \(.testFiles) | \(.reused) | \(.executed) | \(.failedFiles | length) | \(.recorded) | \(.timings.totalMs / 1000) |"' <<<"$all"
  echo
  echo '<details><summary>Executed files and why</summary>'
  echo
  cat "$cache"/work/*/decisions.log 2>/dev/null | grep '^run' | sed -E 's/^run +([^ ]+) \((.*)\)$/- `\1`: \2/' || true
  echo '</details>'
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
echo "Executed and why:"
cat "$cache"/work/*/decisions.log 2>/dev/null | grep '^run' || true
jq -r '.[] | "\(.project)\t\(.globalKey)"' <<<"$all" | while IFS=$'\t' read -r project key; do
  slug=$(sed -E 's/[^A-Za-z0-9_.-]+/-/g' <<<"$project")
  find "$cache/$slug" -mindepth 1 -maxdepth 1 ! -name "$key" -exec rm -rf {} + 2>/dev/null || true
done
rm -rf "$cache/work"
