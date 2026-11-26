# @dltech/atlas-plugin-instructions

Puts the instruction files into the system prompt of each step. The plugin reads the personal and project group instructions from Atlas Cloud, and the `AGENTS.md` chain from the repository root to the project directory. It also reads the nested `AGENTS.md` files under a directory that a tool touches.

## Owns

- The `instructions` resource: the repository root, the project directory, the personal text, the project group text and each `AGENTS.md` file.
- The `instructions-blocks` hook: adds the personal block, the group block and the `AGENTS.md` chain to the system prompt before a step.
- The `instructions-touch` hook: records a nested `AGENTS.md` after a tool touches a directory below the project directory.
- `context-loaded` event drafts for the slot `NestedInstructions`.

## Does not own

- The storage of the personal and group instructions. The caller passes `personal(ctx)` and `group(ctx)` in `InstructionsPodOptions`; `apps/api` reads the Atlas Cloud rows.
- The skills of a repository. `plugins/skills` owns them.
- The instructions that an MCP server offers. `plugins/mcp` owns them.

## Entry points

| Import                                   | Use it for                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-instructions/core` | `instructionsCoreSlots`: empty event, view and command lists.                |
| `@dltech/atlas-plugin-instructions/pod`  | `instructionsPodOf(options)`, the resource, the hooks and the block headers. |

## Capabilities

### Build a pod slot

- `instructionsPodOf({ personal, group })`: makes the pod slot. The `personal` function returns the personal instructions, or `null`. The `group` function returns the instructions of the session project's group, or `null`.
- `instructionsResource(options)`: the resource itself, for a caller that composes the pod differently.
- `INSTRUCTIONS_RESOURCE`: the resource name, `instructions`. The resource reads the file named `AGENTS.md`.

### Write a block

- `PERSONAL_HEADER`, `GROUP_HEADER` and `projectHeader(path)`: the header lines above a personal block, a group block and a project block.

## Plugin contributions

### Pod tier (`instructionsPodOf`)

| Kind     | Name                               | What it adds                                                                      |
| -------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| Resource | `instructions`                     | Reads the personal and group text, the repository root and each `AGENTS.md` file. |
| Hook     | `instructions-blocks` (beforeStep) | Adds the personal and group blocks and the root-to-project `AGENTS.md` chain.     |
| Hook     | `instructions-touch` (afterTool)   | Records the nested `AGENTS.md` of a directory that the tool touched.              |

The resource declares the cloud setting `PersonalInstructions`. It watches the project directory for files named `AGENTS.md`.

### Core tier (`instructionsCoreSlots`)

Declares no events, no views and no commands.

## Usage

```ts
import { instructionsPodOf } from '@dltech/atlas-plugin-instructions/pod'

const instructionsPod = instructionsPodOf({
  personal: async (ctx) => await personalInstructions.personal(ctx.sessionId),
  group: async (ctx) => await groupInstructions.group(ctx.sessionId),
})
```

## Rules

- The prompt order is personal, then group, then `AGENTS.md` from the root down. A repository file wins where the two disagree, because the model reads it later.
- The root is the nearest directory at or above the project directory that holds `.git`. The chain stops at that root.
- The resource skips a file larger than 100 KiB. It reads every candidate file and keeps at most 64 accepted files.
- The reader skips `node_modules` and `.git`.
- The nested files come from the paths that a tool names, before the next step. They do not come from a search of the whole repository at each step.
- Import `@dltech/atlas-plugin-instructions/pod` in the pod only. It reads the filesystem through the pod port.

## See also

- [The v2 package map](../../docs/decisions/0019-v2-package-map.md)
- [`packages/plugin-sdk/src/slots.ts`](../../packages/plugin-sdk/src/slots.ts)
