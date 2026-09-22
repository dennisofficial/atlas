#!/usr/bin/env sh
set -eu

# The releases are public, so downloads are unauthenticated. The installed binary self-updates
# from then on; this script is only ever a bootstrap.

REPO=dennisofficial/atlas

if ! command -v curl >/dev/null 2>&1; then
  printf 'install.sh: curl is required\n' >&2
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

base="https://github.com/$REPO/releases/latest/download"
curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/$asset.sha256" -o "$tmp/$asset.sha256"

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
  *":$dest_dir:"*) exit 0 ;;
esac

display_dir=$dest_dir
case "$dest_dir" in
  "$HOME"/*) display_dir="\$HOME/${dest_dir#"$HOME"/}" ;;
esac
line="export PATH=\"$display_dir:\$PATH\""

rc=
case "${SHELL:-}" in
  */zsh) rc="$HOME/.zshrc" ;;
  */bash)
    if [ -f "$HOME/.bash_profile" ]; then
      rc="$HOME/.bash_profile"
    else
      rc="$HOME/.bashrc"
    fi
    ;;
esac

if [ -z "$rc" ]; then
  printf 'note: %s is not on your PATH — add it to your shell profile: %s\n' "$dest_dir" "$line"
elif [ -f "$rc" ] && grep -qF "$display_dir" "$rc"; then
  printf 'note: %s already puts %s on your PATH — restart your shell to pick it up\n' "$rc" "$dest_dir"
else
  printf '\n%s\n' "$line" >> "$rc"
  printf 'added %s to your PATH in %s — restart your shell to pick it up\n' "$dest_dir" "$rc"
fi
