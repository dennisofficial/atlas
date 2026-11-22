# @dltech/atlas-memory

The memory rows of one user, behind one small API: list, read, write, edit and delete. The memory
plugin's tools and the web settings page both call it, so a memory has one rule set.

## Owns

- The read and write of a `Memory` row in Postgres.
- The revision counter. Every write bumps it, and every edit checks it.
- The `global` and `project` scopes, and the four kinds: `user`, `feedback`, `project` and
  `reference`.
- The errors that a caller maps to a status: invalid, not found, stale revision, edit refused.

## Does not own

- The wire schemas and the limits. `@dltech/atlas-wire` owns them.
- The tools the model calls, and the prompt text. `plugins/memory` owns them.
- The HTTP status codes. `apps/api` owns the mapping.

## Entry points

| Import                 | Use it for                        |
| ---------------------- | --------------------------------- |
| `@dltech/atlas-memory` | Every read and write of a memory. |

## Capabilities

### Read

- `listMemories({ db, userId, project })`: the summaries of the global memories, plus the project
  memories when the caller supplies `project`. Newest first.
- `listAllMemories({ db, userId })`: the summaries of every memory of the user, newest first.
- `getMemory({ db, userId, scope, project, name })`: the entry, with its body. It throws
  `MemoryNotFoundError` when the memory does not exist.

### Write

- `putMemory(args)`: creates the memory at revision 1, or replaces its fields and bumps the
  revision. It returns the summary.
- `editMemory(args)`: replaces one occurrence of `old` in the body and bumps the revision. It
  throws `MemoryStaleRevisionError` when `revision` is not current, and `MemoryEditRefusedError`
  when `old` is absent or occurs more than once.
- `removeMemory(args)`: deletes the memory. A missing memory throws `MemoryNotFoundError`, so a
  repeated delete is not idempotent.

### Name a memory

- `MemoryKey`: `{ userId, scope, project?, name }`. A `project`-scope key needs a `project`. A
  `global` key has none.
- `MemoryScope`, `MemoryKind`: `'global' | 'project'` and `'user' | 'feedback' | 'project' |
  'reference'`.

### Report a failure

- `MemoryInvalidError`, `MemoryNotFoundError`, `MemoryStaleRevisionError`,
  `MemoryEditRefusedError`. The last two carry a `code` that the caller passes to the client.

## Usage

```ts
import { editMemory, putMemory } from '@dltech/atlas-memory'

await putMemory({
  db,
  userId,
  scope: 'project',
  project: 'dennis/atlas',
  name: 'bun-deflate-is-raw',
  description: '...',
  type: 'project',
  body: '...',
})
await editMemory({
  db,
  userId,
  scope: 'project',
  project: 'dennis/atlas',
  name: 'bun-deflate-is-raw',
  old: 'raw',
  replacement: 'zlib',
  revision: 1,
})
```

## Rules

- Read the memory again after a `MemoryStaleRevisionError`. Never retry the same revision.
- Give `project` for a `project`-scope key, and leave it out for a `global` key. A wrong pair throws
  `MemoryInvalidError`.
- Keep the body below the limit `MAX_MEMORY_BODY_CHARS`. The edit path checks it.

## See also

- `docs/decisions/0009-memory-is-rows-behind-tools.md` for why memories are rows.
- `packages/wire/src/memory-wire.ts` for the schemas and the error codes.
