# 0011. Skills, instructions and MCP config reach pods by `atlas push`

Accepted 2026-10-20.

## Context

Pods need the user's skills, global instructions and MCP config. Two options were packing them
from the laptop at every birth (the context archive) or syncing the user layer continuously.
Locally that is tens of megabytes across thousands of files, most of which a pod never needs.

## Decision

The user publishes explicitly. `atlas push` (`apps/tui/src/composition/push.ts`,
`apps/tui/src/composition/push-run.ts`) scans skills, the global `ATLAS.md` and `mcp.json`
(`packages/harness/src/publish/publishables.ts`), shows a picker of new and changed items, packs the selection, uploads it to private Vercel Blob
through a presigned URL, and commits a new `PublishedBundle` version. Every pod boot downloads the
current version, checks its SHA-256, and installs only skill, instruction and MCP entries
(`apps/serve/src/published-bundle.ts`).

## Why

Publishing is a deliberate act with a visible result. The pod gets exactly what the user chose,
and birth does not depend on the laptop's state.

## Consequences

- The context archive is deleted, so a birth uploads nothing from the laptop's user layer and the
  bundle is the only source of skills, instructions and MCP config in a pod.
- No pod runs the user-layer sync; it is a no-op in every pod.
- A wake picks up a newer version, because the bundle is applied on every boot.
- Memory never rides in a bundle; see 0009.
- Old bundle blobs are not deleted.
