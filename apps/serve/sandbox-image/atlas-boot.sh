#!/bin/sh
# https://www.agent37.com/docs/agents-api/exec — an Agent37 workspace kills every exec after about
# a second, so the daemon boots from PID 1 here instead. Without ATLAS_DAEMON_BUNDLE_URL the script
# is a plain entrypoint and every other sandbox provider sees the image it saw before.
set -u

DAEMON_HOME=/atlas/home/.atlas/daemon
BUNDLE_URL="${ATLAS_DAEMON_BUNDLE_URL:-}"

if [ -z "$BUNDLE_URL" ]; then
  if [ "$#" -gt 0 ]; then
    exec "$@"
  fi
  exec sleep infinity
fi

mkdir -p "$DAEMON_HOME" /atlas/docker
# Not the shim: a mise shim rewrites PATH for every process it starts, and the daemon passes its
# env to every agent shell, which would then ignore the repository's pinned bun and node. mise
# itself answers with the version its config selects; the glob covers an image where it cannot.
BUN="$(cd / && mise which bun 2>/dev/null | head -n 1)"
if [ ! -x "${BUN:-}" ]; then
  BUN=/opt/mise/installs/bun/latest/bin/bun
  [ -x "$BUN" ] || BUN="$(ls -d /opt/mise/installs/bun/*/bin/bun 2>/dev/null | head -n 1)"
fi
if [ ! -x "${BUN:-}" ]; then
  BUN=/opt/mise/shims/bun
  echo "atlas-boot: no concrete bun under /opt/mise/installs/bun, falling back to the shim" >&2
fi
# The Agent37 vm cannot create a bridge interface at all (dockerd: "Failed to create bridge docker0
# via netlink: operation not supported") nor reach netfilter (iptables: Failed to initialize nft:
# Protocol not supported), so its dockerd runs without a bridge; containers need --network host.
# /usr/bin/docker, not the shim: the shim would start a daemon of its own with the default flags.
if ! /usr/bin/docker info >/dev/null 2>&1; then
  nohup dockerd --data-root /atlas/docker --bridge=none --iptables=false --ip6tables=false \
    --userland-proxy=false >>"$DAEMON_HOME/dockerd.log" 2>&1 &
fi

while :; do
  if curl -fsSL \
    -H "Authorization: Bearer ${DAEMON_TOKEN:-}" \
    -H "X-Atlas-Sandbox: ${ATLAS_SANDBOX_NAME:-}" \
    "$BUNDLE_URL" -o "$DAEMON_HOME/daemon.js.next"; then
    mv "$DAEMON_HOME/daemon.js.next" "$DAEMON_HOME/daemon.js"
  fi
  if [ -f "$DAEMON_HOME/daemon.js" ]; then
    ATLAS_DAEMON_BUNDLE_VERSION="$(sha256sum "$DAEMON_HOME/daemon.js" | cut -d' ' -f1)"
    printf '%s\n' "$ATLAS_DAEMON_BUNDLE_VERSION" >"$DAEMON_HOME/version"
    ATLAS_DAEMON_BUNDLE_VERSION="$ATLAS_DAEMON_BUNDLE_VERSION" \
      "$BUN" "$DAEMON_HOME/daemon.js" >>"$DAEMON_HOME/daemon.log" 2>&1
  fi
  sleep 1
done
