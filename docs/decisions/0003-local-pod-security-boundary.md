# 0003. Local pods run privileged, with only their own volumes

Accepted 2026-10-19.

## Context

Agents run Docker inside their pod (compose stacks, test databases). Docker-in-Docker needs a
privileged container. The older local sandbox instead mounted the host's Docker socket, which hands
the agent control of every container on the machine.

## Decision

A local pod runs `Privileged: true`, with three limits:

- never mount the host Docker socket;
- never bind-mount a host path;
- attach only the pod's own named volumes: `<pod>-workspace` on `/atlas/workspaces` and
  `<pod>-docker` on `/var/lib/docker`.

The create body is `podCreateBody` in `packages/harness/src/cloud/local-pod/pod-create.ts`, and
`packages/harness/src/cloud/local-pod/__tests__/pod-create.spec.ts` holds it to that shape.

## Why

The container is the isolation boundary. With no socket and no host mount, a pod has no path to
the operator's files or other containers. Privileged is still broad: on Docker Desktop the engine
runs in a VM, which bounds it; on a Linux host it is close to root on the host.

## Consequences

- The workspace is a fresh clone inside the pod, never the host checkout. Edits do not appear in
  the operator's editor; work leaves by `git push`.
- Ports publish to `127.0.0.1` only.
- `apps/serve/sandbox-image/README.md` still describes the old socket passthrough and is stale.
