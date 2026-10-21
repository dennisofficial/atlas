# 0002. Docker is the only local engine

Accepted 2026-10-19.

## Context

Local pods needed an engine. The candidates were Docker Desktop, Podman and Apple `container`,
with Vercel Sandbox as the cloud reference. A spike tested each on four capabilities: start a pod,
run Docker inside it, expose ports opened after boot, and change CPU and memory while it runs.

## Decision

One local driver, `DockerPodDriver` (`packages/harness/src/cloud/local-pod/driver.ts`), talking to
the Docker Engine API over its Unix socket (`packages/harness/src/execution/docker/engine-http.ts`).
No Podman-specific driver and no Apple `container` driver.

## Why

Docker passed all four capabilities and started fastest. Apple `container` has no Docker-compatible
API and needs macOS 26 on Apple silicon. On macOS, Podman runs a VM like Docker does and serves
the Docker API anyway, so a second driver would buy nothing. One driver is less to keep working.

## Consequences

- Ports opened after boot go through an in-pod ingress on one extra published port
  (`packages/harness/src/cloud/local-pod/ingress.ts`).
- Resize is live through `POST /containers/<id>/update`.
- Memory is a reservation (`MemoryReservation`) with no hard cap.
- Docker inside the pod needs `--privileged` and a named volume on `/var/lib/docker`; see 0003.
- The workspace lives on a named volume, so it survives the container being recreated.
