# 0009. Memory is database rows behind tools, and starts empty

Accepted 2026-10-20.

## Context

Memory was markdown files under `~/.atlas` with a `MEMORY.md` index the model maintained. A pod
cannot see the laptop's files, and syncing a writable file tree both ways between pods and
laptops would need conflict handling for every write.

## Decision

Memory is the `Memory` table in Atlas Cloud (`apps/api/prisma/schema.prisma`): scope, project,
name, description, type, body and revision. The model reaches it only through four tools,
`read_memory`, `write_memory`, `edit_memory` and `delete_memory`
(`packages/harness/src/tools/builtin/memory-*.ts`), over `CloudMemoryPort`
(`packages/harness/src/memory/cloud-memory-port.ts`) and `/v1/memories`. `edit_memory` applies
old/new strings on the server and fails on a stale revision. A before-turn hook lists the rows and
renders the index into the system prompt, once and again after a failed load
(`packages/harness/src/hooks/load-memory.ts`, `packages/core/src/memory/index-render.ts`); the model
never writes an index. Existing memory files are not imported.

## Why

Rows with revisions give one source of truth that every session reaches the same way, with
conflicts caught by the revision instead of by a merge.

## Consequences

- Host sessions use the same cloud memory. Signed out, the memory tools refuse and the session
  still runs.
- Memory writes are pod-reachable, unlike other cloud stores
  (`apps/api/src/api/cloud/memories/memories.controller.ts`).
- Old memory files stay on disk and are ignored.
