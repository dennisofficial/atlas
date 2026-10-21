# 0001. The per-session container is a pod

Accepted 2026-10-19.

## Context

A session can run outside the Atlas process in a local Docker container or in a Vercel Sandbox.
The code called both "sandboxes", after the Vercel product, so the word named a provider rather
than the thing every session runs in. The candidates were "runner" and "orb".

## Decision

The container a session runs in is a **pod**, whichever provider hosts it. The provider is the
**runner**: `local` (Docker) or `vercel` (`ERunner` in `packages/core/src/execution/runner.ts`).

## Why

One location-free noun keeps local and cloud the same concept. If local were a "runner" and cloud
an "orb", the vocabulary would encode location, and the harness is meant to be location-agnostic.

## Consequences

- New code and docs say pod and runner.
- The rename of existing code has not happened. `CloudSandbox`, `/v1/sandboxes/*`,
  `@SandboxReachable()`, `sandbox-*.ts` and the `atlas-sandbox` image keep the old word, and a
  Vercel pod is still named `atlas-thread-<hash>`.
- Podman and Kubernetes already use "pod" for a group of containers. Here a pod is one container.
