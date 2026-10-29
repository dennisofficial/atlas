# 0014. A local pod's token reaches what a Vercel pod's does, minus the Vercel-only controls

Accepted 2026-10-28.

## Context

A local pod's lease token (`LocalPodLease`) used to reach only procedures marked
`meta({ podReachable: true })` and got 403 everywhere else, its own thread included. So boot history
hydration, PR tracking and in-pod model persistence failed in a local pod while the same session
worked in a Vercel pod. And because a local pod had no API `Thread` row, its park checkpoint never
reached the API.

## Decision

- A local pod authenticates as a principal equal to a Vercel sandbox in
  `SessionOrSandboxMiddleware`: procedures whose input names a `threadId` in its own thread family,
  plus threadless procedures marked `sandboxReachable`.
- The exceptions are the procedures that physically drive Vercel: `sandboxSelf.stop`,
  `sandboxSelf.exposePort` and `sandboxSelf.bootSteps` stay sandbox-only
  (`sandbox-token.middleware.ts`).
- A local pod's birth registers its `Thread` row, after its lease. Its checkpoints live in
  `LocalPodCheckpoint`, never in a `CloudSandbox` row, so nothing that manages Vercel sandboxes
  (`claimRow`, web send, `sandboxes.stop`/`park`, the GitHub subscription FK) can mistake a laptop
  container for one.

## Why

One policy is easier to reason about than two. The exceptions are exactly where the API would
otherwise drive a provider the pod does not run on.

## Consequences

- The API treats a laptop container's token as a family-scoped bearer for the owner's threads,
  the same trust a Vercel sandbox token already carries. Beyond its thread family, either kind of
  pod can write memory, the user-files store, GitHub PR subscriptions and direct sub-agent threads;
  settings, secrets, accounts, Projects, bundles and the signing key need a user session.
- The per-procedure allow/deny table is contract-tested in `session-or-sandbox.middleware.spec.ts`
  and `pod-lease-auth.spec.ts`.
- Reverting would orphan `LocalPodCheckpoint` rows and break hydration again, so this is durable.
