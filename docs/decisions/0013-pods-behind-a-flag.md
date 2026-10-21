# 0013. Pods sit behind `experimental.pods`; the TUI stays local, the web goes cloud-first

Accepted 2026-10-20.

## Context

The plan was for every session to run in a pod, so #1330 deleted the in-process host session and
required an Atlas Cloud sign-in to start anything. In daily use that made every TUI session pay
for a container boot and a sign-in, while the surface that actually needs pods, the web app, had
no session UI yet.

## Decision

- The pod runner goes behind a boolean setting, `experimental.pods`, default off
  (`packages/core/src/settings/registry.ts`, env `ATLAS_EXPERIMENTAL_PODS`). It is read once at
  launch in `composeAtlas` (`apps/tui/src/composition/compose.ts`) and passed down as `app.pods`.
- Off: sessions run in-process on the host as they did up to v1.118.0, host threads list, and there
  is no pod chip, no sign-in gate and no Docker preflight.
- On: first-send birth into a local Docker or Vercel pod, Projects, and cloud-backed stores.
- The TUI stays local. The web app is the cloud surface, built on the same API and serve work
  (Projects, cloud memory, `atlas push`, the account lease). TUI parity follows once web works.

## Why

Instant in-process sessions are what the TUI's daily users need. The pod work is kept, not
deleted, because the web app needs exactly that machinery.

## Consequences

- Both session kinds must keep working, and pod-only paths may be deleted only where flag-off
  mode does not use them.
- What stays the same in both modes: the GPG export is gone (0006) and memory is in the cloud
  (0009).
- This supersedes "sign-in required to start a session" while the flag is off.
