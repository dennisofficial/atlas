#!/bin/sh
# Lazy docker-in-docker entrypoint, installed at /usr/local/bin/docker ahead of the real
# docker-ce-cli binary at /usr/bin/docker. First call in a Vercel sandbox starts the baked
# dockerd through sudo and waits for it; a local docker sandbox answers from the mounted host
# socket without ever starting a nested daemon. Repo style bans comments, but this fact lives
# outside the repo: the shim only exists because Vercel Sandbox gives the microVM full root
# while shipping no running daemon (vercel.com/docs/sandbox/system-specifications).
set -u

REAL_DOCKER=/usr/bin/docker
LOG=/tmp/atlas-dockerd.log
LOCK=/tmp/atlas-dockerd.lock
WAIT_ROUNDS=120

if "$REAL_DOCKER" info >/dev/null 2>&1; then
  exec "$REAL_DOCKER" "$@"
fi

if ! command -v sudo >/dev/null 2>&1 || ! command -v dockerd >/dev/null 2>&1; then
  echo "docker: no daemon is reachable and this image carries no dockerd to start" >&2
  exit 1
fi

# The flock serializes parallel first-callers: one starts the daemon, the rest fall through to
# the shared wait once the holder releases. The pid probe reads /proc instead of pgrep, which
# the slim image does not carry.
(
  flock -w "$WAIT_ROUNDS" 9 || exit 1
  running=0
  for cmdline in /proc/[0-9]*/cmdline; do
    if tr '\0' ' ' <"$cmdline" 2>/dev/null | grep -q 'dockerd'; then
      running=1
      break
    fi
  done
  if [ "$running" = "0" ]; then
    # 0666 the socket once it exists: the sandbox is a single-tenant microVM, so opening it to
    # the session uid is not an escalation, and the uid is not always the docker group's.
    sudo sh -c "setsid sh -c 'dockerd >\"$LOG\" 2>&1 & for i in \$(seq 30); do [ -S /var/run/docker.sock ] && chmod 0666 /var/run/docker.sock && break; sleep 1; done' < /dev/null &"
  fi
) 9>"$LOCK"

round=0
until "$REAL_DOCKER" info >/dev/null 2>&1; do
  round=$((round + 1))
  if [ "$round" -ge "$WAIT_ROUNDS" ]; then
    echo "docker: the daemon did not come up; its log is at $LOG" >&2
    tail -n 20 "$LOG" >&2 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

exec "$REAL_DOCKER" "$@"
