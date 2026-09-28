#!/bin/sh
# Warms the lazy dockerd without running a real docker command, so an agent can pay the startup
# once and keep later docker calls fast. Exits 0 once `docker info` answers.
set -u
exec docker info >/dev/null
