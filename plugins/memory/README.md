# @dltech/atlas-plugin-memory

Gives a thread named memory entries that live in Atlas Cloud, and puts the memory index into the system prompt. The `memory` tool writes, reads, edits and deletes an entry in the global scope or the project scope.

## Owns

- The `memory` tool and its four actions: `write`, `read`, `edit` and `delete`.
- The `memory-index` resource and the `memory-index` hook that adds the index to each step.
- The `memory-reconcile` notice that tells the model when the index grows too large.
- `memoryIndexOf({ project, memories })`: the text of the index, grouped by scope.

## Does not own

- Storage. The `PodMemory` port on `ctx.control.memory` reads and writes the entries.
- The text that describes the memory rules to the model. `memoryPromptText()` in `packages/core` gives it.
- The memory screen. Each client draws it.

## Entry points

| Import                                | Use it for                                                             |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `@dltech/atlas-plugin-memory/core`    | `memoryIndexOf` and `memoryCoreSlots`.                                 |
| `@dltech/atlas-plugin-memory/pod`     | `memoryPod`: the tool, the hook, the resource and the prompt fragment. |
| `@dltech/atlas-plugin-memory/control` | `memoryControl`: an empty control slot.                                |
| `@dltech/atlas-plugin-memory/client`  | `memoryClient`: a client slot with no hook.                            |

## Capabilities

### Read the index

- `memoryIndexOf({ project, memories })`: the index text. It lists the global entries first, then the project entries, and writes `(none yet)` for an empty scope.

### Use the tool

- `MEMORY_TOOLS`: the list that holds `memory`.
- `withMemoryIndex({ assembled, ctx })`: adds the index block to an assembled prompt, or adds nothing when no load of the index has been recorded yet.

## Plugin contributions

### Pod tier (`memoryPod`)

| Kind       | Name                        | What it adds                                                                      |
| ---------- | --------------------------- | --------------------------------------------------------------------------------- |
| Tool       | `memory`                    | `write`, `read`, `edit` and `delete` on one entry in the global or project scope. |
| Hook       | `memory-index` (beforeStep) | Adds the index to the system prompt once a load is recorded, and nothing before.  |
| Resource   | `memory-index`              | The rendered index text for this session.                                         |
| Prompt     | `memory.instructions`       | Describes the four kinds of memory and the rules for each.                        |
| Child deny | `memory`                    | A sub-agent cannot call the tool.                                                 |

A write can also return a system notice of kind `memory-reconcile`. The notice names the entries that need a rewrite, so the index stays small.

### Core tier (`memoryCoreSlots`)

Declares no events, no views and no commands.

### Client tier (`memoryClient`)

`memoryClient` has no hook. The transcript shows the tool call as it is.

### Control tier (`memoryControl`)

Empty. The plugin has no control hook and no control command.

## Usage

```ts
import { memoryClient } from '@dltech/atlas-plugin-memory/client'
import { memoryControl } from '@dltech/atlas-plugin-memory/control'
import { memoryCoreSlots } from '@dltech/atlas-plugin-memory/core'
import { memoryPod } from '@dltech/atlas-plugin-memory/pod'
import { definePlugin } from '@dltech/atlas-plugin-sdk'

definePlugin({
  name: 'memory',
  ...memoryCoreSlots,
  pod: memoryPod,
  control: memoryControl,
  client: memoryClient,
  transport: 'none',
})
```

## Rules

- A name is lowercase words joined by hyphens, at most 100 characters, and states one claim.
- `write` needs `scope`, `name`, `description`, `type` and `body`. `type` is `user`, `feedback`, `project` or `reference`.
- `edit` needs the `revision` that the last read reported, plus `old` and `new`. The tool refuses the edit when the entry changed since that read.
- `old` must occur exactly once in the body. The edit fails when it does not.
- The description is one line and one claim, at most 200 characters. The index shows it, so a long description crowds the prompt.
- A body is at most 20,000 characters.

## See also

- [The v2 package map](../../docs/decisions/0019-v2-package-map.md)
- [`packages/plugin-sdk/src/memory.ts`](../../packages/plugin-sdk/src/memory.ts)
