#!/usr/bin/env sh
set -eu

# The mirror needs no login and outlives the repository's visibility and owner. github.com is the
# fallback, for the window before the mirror has every asset. The installed binary self-updates from
# then on; this script is only ever a bootstrap.

REPO=dennisofficial/atlas
MIRROR=https://install.byatlas.io

usage() {
  printf 'usage: install.sh [tui|serve] [VERSION]\n' >&2
  exit 2
}

flavor=tui
if [ $# -gt 0 ]; then
  case "$1" in
    tui | serve)
      flavor=$1
      shift
      ;;
    *) usage ;;
  esac
fi
[ $# -le 1 ] || usage
version=${1:-latest}

if ! command -v curl >/dev/null 2>&1; then
  printf 'install.sh: curl is required\n' >&2
  exit 1
fi

platform="$(uname -s)-$(uname -m)"

case "$flavor" in
  serve)
    case "$platform" in
      Linux-x86_64) asset=atlas-serve-linux-x64 ;;
      Linux-aarch64 | Linux-arm64) asset=atlas-serve-linux-arm64 ;;
      *)
        printf 'install.sh: serve ships linux-x64 and linux-arm64 only, not %s\n' "$platform" >&2
        exit 1
        ;;
    esac
    binary=atlas-serve
    ;;
  tui)
    case "$platform" in
      Darwin-arm64) asset=atlas-darwin-arm64 ;;
      Darwin-x86_64) asset=atlas-darwin-x64 ;;
      Linux-x86_64) asset=atlas-linux-x64 ;;
      *)
        printf 'install.sh: no prebuilt binary for %s\n' "$platform" >&2
        exit 1
        ;;
    esac
    binary=atlas
    ;;
esac

dest_dir=${ATLAS_INSTALL_DIR:-"$HOME/.local/bin"}
dest="$dest_dir/$binary"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/atlas-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

if [ "$version" = latest ]; then
  path=releases/latest/download
else
  version=${version#tui-v}
  version=${version#v}
  [ -n "$version" ] || usage
  path="releases/download/tui-v$version"
fi
base="$MIRROR/$path"
fallback="https://github.com/$REPO/$path"

fetch() {
  if [ -t 2 ]; then
    curl -fSL --progress-bar "$1" -o "$2" || {
      printf '%s did not answer, retrying from github.com\n' "$MIRROR" >&2
      curl -fSL --progress-bar "$3" -o "$2"
    }
  else
    curl -fsSL "$1" -o "$2" || {
      printf '%s did not answer, retrying from github.com\n' "$MIRROR" >&2
      curl -fsSL "$3" -o "$2"
    }
  fi
}

printf 'downloading %s (about 100MB)\n' "$asset" >&2
fetch "$base/$asset" "$tmp/$asset" "$fallback/$asset"
fetch "$base/$asset.sha256" "$tmp/$asset.sha256" "$fallback/$asset.sha256"

printf 'verifying sha256 checksum\n' >&2

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

printf 'installing to %s\n' "$dest" >&2
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
