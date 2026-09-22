#!/usr/bin/env sh
set -eu

# The repo is private, so every download rides on gh auth — there is no unauthenticated URL to
# curl. The installed binary self-updates from then on; this script is only ever a bootstrap.

REPO=dennisofficial/atlas

if ! command -v gh >/dev/null 2>&1; then
  printf 'install.sh: gh is required (the releases are private) — https://cli.github.com\n' >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  printf 'install.sh: gh is not authenticated — run gh auth login first\n' >&2
  exit 1
fi

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) asset=atlas-darwin-arm64 ;;
  Darwin-x86_64) asset=atlas-darwin-x64 ;;
  Linux-x86_64) asset=atlas-linux-x64 ;;
  *)
    printf 'install.sh: no prebuilt binary for %s-%s\n' "$(uname -s)" "$(uname -m)" >&2
    exit 1
    ;;
esac

dest_dir=${ATLAS_INSTALL_DIR:-"$HOME/.local/bin"}
dest="$dest_dir/atlas"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/atlas-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

gh release download --repo "$REPO" --pattern "$asset" --pattern "$asset.sha256" --dir "$tmp" --clobber

if command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')
else
  actual=$(sha256sum "$tmp/$asset" | awk '{print $1}')
fi
expected=$(awk '{print $1}' "$tmp/$asset.sha256")

if [ "$actual" != "$expected" ]; then
  printf 'install.sh: sha256 mismatch on %s — refusing to install\n' "$asset" >&2
  exit 1
fi

mkdir -p "$dest_dir"
install "$tmp/$asset" "$dest"

printf 'installed %s to %s\n' "$asset" "$dest"

case ":$PATH:" in
  *":$dest_dir:"*) ;;
  *) printf 'note: %s is not on your PATH\n' "$dest_dir" ;;
esac
