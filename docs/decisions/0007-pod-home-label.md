# 0007. Local pods carry the hash of the Atlas home that owns them

Accepted 2026-10-19.

## Context

At boot the TUI reaps local pods whose thread it no longer knows. Several Atlas homes can share one
Docker daemon: the prod `atlas` binary, `atlas-dev`, and webterm scratch homes. Each has its own
thread store, so each would see the others' pods as orphans and destroy them, workspace volumes
included.

## Decision

Every pod and its volumes carry `atlas-pod.home`, the first 16 hex characters of the SHA-256 of
the Atlas home path (`podHomeDigestOf` in `packages/harness/src/cloud/local-pod/pod-create.ts`).
The reaper lists only containers whose `atlas-pod.home` matches its own home, and a pod without
the label is never reaped (`packages/harness/src/cloud/local-pod/reaper.ts`).

## Why

Ownership has to be decided by the home that created the pod. The thread id alone can't do that,
because a thread missing from one home's store says nothing about another home's.

## Consequences

- The digest is of the path string from `atlasDirectory()`, not a resolved real path, so two
  spellings of one directory count as two homes.
- A pod with no home label leaks until someone removes it by hand. That is the safe failure.
