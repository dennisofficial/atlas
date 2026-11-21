#!/usr/bin/env bash
# Creates a commit through GraphQL createCommitOnBranch so GitHub web-signs it
# (Verified). The REST git and contents APIs produce unsigned commits on public
# repos, and Vercel refuses to build unsigned commits in this repo. Runs against
# GITHUB_REPOSITORY and uses GH_TOKEN (GITHUB_TOKEN with contents:write).
#
# Usage:
#   api-commit.sh --branch <name> --message <msg> [--base <sha>] -- <path>...
#
# --branch   Branch to create (at --base) or append to when it already exists.
# --message  Commit headline.
# --base     Commit a new branch starts from; defaults to origin/main, then HEAD.
# <path>...  Files to add or overwrite, read from the current working tree.
#
# Prints the new commit sha.

set -euo pipefail

branch=
message=
base=
paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) branch="$2"; shift 2 ;;
    --message) message="$2"; shift 2 ;;
    --base) base="$2"; shift 2 ;;
    --) shift; paths+=("$@"); break ;;
    *) echo "api-commit.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$branch" ] && [ -n "$message" ] && [ "${#paths[@]}" -gt 0 ] || {
  echo "usage: api-commit.sh --branch <name> --message <msg> [--base <sha>] -- <path>..." >&2
  exit 2
}

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

if [ -z "$base" ]; then
  base=$(git rev-parse --verify --quiet origin/main || git rev-parse HEAD)
fi

if head=$(gh api "repos/$repo/git/refs/heads/$branch" --jq .object.sha 2>/dev/null); then
  :
else
  gh api "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$base" >/dev/null
  head="$base"
fi

files=()
for path in "${paths[@]}"; do
  if [ -d "$path" ]; then
    while IFS= read -r file; do
      files+=("$file")
    done < <(find "$path" -type f | sort)
  else
    files+=("$path")
  fi
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

entries=()
index=0
for path in "${files[@]}"; do
  tree_path=${path#"$PWD"/}
  tree_path=${tree_path#./}
  index=$((index + 1))
  base64 < "$path" | tr -d '\n' > "$work/content"
  jq -n --arg path "$tree_path" --rawfile content "$work/content" \
    '{path: $path, contents: $content}' > "$work/entry-$index.json"
  entries+=("$work/entry-$index.json")
done

if [ "${#entries[@]}" -gt 0 ]; then
  jq -s '.' "${entries[@]}" > "$work/additions.json"
else
  echo '[]' > "$work/additions.json"
fi

jq -n --arg repo "$repo" --arg branch "$branch" --arg message "$message" \
  --arg head "$head" --slurpfile additions "$work/additions.json" \
  '{query: "mutation($repo: String!, $branch: String!, $message: String!, $head: GitObjectID!, $additions: [FileAddition!]!) { createCommitOnBranch(input: {branch: {repositoryNameWithOwner: $repo, branchName: $branch}, message: {headline: $message}, fileChanges: {additions: $additions}, expectedHeadOid: $head}) { commit { oid } } }",
    variables: {repo: $repo, branch: $branch, message: $message, head: $head, additions: $additions[0]}}' \
  > "$work/payload.json"

gh api graphql --input "$work/payload.json" --jq .data.createCommitOnBranch.commit.oid
