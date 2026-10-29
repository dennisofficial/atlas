# 0015. A local pod's threads stay local; its token reaches only an allow-list

Accepted 2026-10-29. Supersedes [0014](0014-local-pod-principal-is-sandbox-reach.md).

## Context

0014 gave a local pod's lease token the same family-scoped reach as a Vercel sandbox token, and
registered every local pod's thread as an API `Thread` row with a mirrored park checkpoint. The
web then listed laptop threads it cannot open or send to. Auditing every API call a local pod
makes showed that nothing it uses is thread-scoped: OAuth access tokens, the account lease, scoped
config, memory, GitHub subscriptions and previews are all keyed by user.

## Decision

- A local pod's thread never gets an API `Thread` row, `Event` rows or a checkpoint row. The TUI
  registers only the pod's lease (`podLeases.register`).
- A local pod's lease token reaches only procedures marked `meta({ podReachable: true })`: OAuth
  access tokens, the account lease, scoped config, settings, secrets, the project workspace, the
  signing key, the published bundle, cloud instructions (`userFiles.get`), memory, GitHub
  subscriptions and the PR stream, and `sandboxSelf.exposePort`. It has no thread-family reach.
- `sandboxReachable` alone no longer admits a pod token. A Vercel sandbox token is unchanged.
- Serve detects a local pod by `ATLAS_POD_NAME` (`isLocalPod` in `@dltech/atlas-wire`). A local pod
  skips boot history hydrate, event write-behind and truncate, model persist and the checkpoint
  mirror. Auto-resume is unchanged. The checkpoint is still captured and written to the pod's own
  disk and socket.
- The bridge's `find` returns `checkpoint: null`. No local reader replaces `localPodCheckpoint.get`.
- A migration deletes existing local-pod `Thread` rows and their sub-agent threads, and drops
  `LocalPodCheckpoint`.
- The API's refusal to provision or send into a leased thread (#1443) stays. The lease still
  identifies a stale or hand-picked thread ID.

## Why

A token should carry only what its holder uses. Nothing a local pod calls needs a thread, so the
rows bought nothing except a cloud listing of threads the cloud cannot run. One explicit
allow-list also means a new sandbox procedure never silently opens to laptops.

## Consequences

- A procedure a local pod must call needs `podReachable`. Marking it `sandboxReachable` does not
  reach a pod, and neither marking admits a thread-family `threadId` input for a pod.
- `find` carries no checkpoint. `cloud-open.ts` already wakes a parked pod eagerly and the PR
  forwarder checks only that the pod is running, so nothing reads it today. Opening a parked local
  pod without waking it is a separate gap and would need a stopped-container read.
- The checkpoint file lives in the container's writable layer (`/atlas/home`), not on a volume. It
  survives stop and start and is lost if the container is removed.
- Remote control from a phone goes through live rendezvous with the laptop
  (`docs/architecture.md`), not stored rows. Cloud transcript backup would be its own explicit
  feature.
- Reverting means restoring `LocalPodCheckpoint` and the registration call; the deleted rows do not
  come back.
