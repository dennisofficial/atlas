# @dltech/atlas-plugin-crew

Gives a thread its sub-agents and its git worktrees. The main thread starts a sub-agent, sends it more messages and stops it. A sub-agent reports to the thread that started it. The same tier moves a session into a worktree.

## Owns

- The three crew tools: `agent_spawn`, `agent_stop` and `agent_list`.
- The three worktree tools: `enter_worktree`, `exit_worktree` and `worktree_list`.
- The five built-in agent types `general-purpose`, `explore`, `researcher`, `builder` and `reviewer`, each with its prompt contract.
- The agent types that a repository defines in `.agents/agents/*.md`. Each file needs a `description` and a prompt body.
- The `crew` view: one row for each sub-agent of the session.
- The `worktree-entered` and `worktree-exited` event drafts that the worktree tools make.

## Does not own

- Sub-agent execution and the child thread. The `PodCrew` port carries it; `packages/host` runs it.
- The worktree operations. The `PodWorktrees` port carries them; `packages/host` runs them.
- The display of the `crew` view. A client draws it.

## Entry points

| Import                              | Use it for                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@dltech/atlas-plugin-crew/core`    | The `crew` view fold, the row schema, the built-in agent types and the repository agent parser. |
| `@dltech/atlas-plugin-crew/pod`     | `crewPod`: the tools, the repository agent type resource, the hooks and the prompt fragment.    |
| `@dltech/atlas-plugin-crew/control` | `crewControl`: an empty control slot.                                                           |
| `@dltech/atlas-plugin-crew/client`  | `crewClient`, `crewOfView` and `crewRosterOf`: the client hook and two view readers.            |

## Capabilities

### Start and steer a sub-agent

- `CREW_AGENT_TYPES` and `crewAgentTypeOf(name)`: the built-in agent types and a lookup by name.
- `parseRepoAgentType({ text, fallbackName, definedIn })`: reads one `.agents/agents` file. The result holds the type, or the reason the parser refuses the type.
- `reservationOf(name)`: says why a name is not available to a repository agent type, such as a built-in name.
- `foldCrew(state, event)`: folds the agent events into the `crew` rows. `crewOfEvents(events)` applies the fold to a list.

A repository agent type is a Markdown file with frontmatter and a prompt body:

```text
---
name: reviewer
description: Checks a change for correctness and for the conventions of this repository.
---
Review the change you are given. Report each finding with its path and line. Do not fix it.
```

The name takes lowercase letters, digits and dashes, and it starts with a letter. A built-in name
and `teammate` are reserved. The file needs a `description` and a nonempty prompt body.

### Wake once for a group of sub-agents

When you spawn several sub-agents in one response, they form a group. `agent_spawn` records the
call id of the step's first tool call as the group of the new sub-agent, so the harness still knows
the group after it compacts the log. A clean ending of a group member does not wake you. The
harness wakes you one time, when the last member ends. Then you get every ending of the group
together, one notice for each sub-agent. A failure, or a stop the operator asked for, wakes you
at once, and the group stays open. A teammate never joins a group.

Do not report or fix the early wake when a sibling registers late. The loop dispatches the tool
calls of a step only after the response is complete, and it runs the `agent_spawn` calls of one
step in parallel. A member that ends before a sibling is in the `CrewRoom` wakes you early. For
this, the member must finish a full model turn while the sibling creates its thread or worktree.
The result is one extra wake, and no ending is lost. The operator accepted this on 2026-11-23.

### Move the session into a worktree

- `WORKTREE_TOOLS`: the tool names `enter_worktree`, `exit_worktree` and `worktree_list`.

## Plugin contributions

### Pod tier (`crewPod`)

| Kind       | Name                                   | What it adds                                                                                                 |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tool       | `agent_spawn`                          | Starts a sub-agent with `agentType`, `intent`, `brief` and an optional `worktree`, and names its group size. |
| Tool       | `agent_stop`                           | Ends a sub-agent after the step it takes.                                                                    |
| Tool       | `agent_list`                           | Lists the sub-agents of this thread with their status, turns and tool calls.                                 |
| Tool       | `enter_worktree`                       | Creates a worktree by `name`, or adopts an existing one by `path`.                                           |
| Tool       | `exit_worktree`                        | Leaves the worktree with `keep` or `remove`.                                                                 |
| Tool       | `worktree_list`                        | Lists the worktrees of the repository with their branch.                                                     |
| Resource   | `crew-agent-types`                     | Reads `.agents/agents` and reports the types and the refusals.                                               |
| Hook       | `crew-repo-agent-listing` (beforeStep) | Adds the repository agent types to the system prompt.                                                        |
| Hook       | `crew-worktree-track` (afterTool)      | Writes `worktree-entered` and `worktree-exited` from the tool output.                                        |
| Prompt     | `crew.subagents`                       | Describes the crew tools, the group wake rule and the agent types to the model.                              |
| Child deny | three names                            | A sub-agent cannot call `agent_spawn`, `agent_stop` or `agent_list`.                                         |

### Core tier (`crewCoreSlots`)

| Kind | Name   | What it adds                                    |
| ---- | ------ | ----------------------------------------------- |
| View | `crew` | The rows that `foldCrew` keeps for the session. |

`crewCoreSlots` declares no events and no commands.

### Client tier (`crewClient`)

| Kind | Name          | What it adds                                      |
| ---- | ------------- | ------------------------------------------------- |
| Hook | `crew-roster` | Applies to each event whose type starts `agent-`. |

### Control tier (`crewControl`)

Empty. The plugin has no control hook and no control command.

## Usage

```ts
import { crewClient } from '@dltech/atlas-plugin-crew/client'
import { crewControl } from '@dltech/atlas-plugin-crew/control'
import { crewCoreSlots } from '@dltech/atlas-plugin-crew/core'
import { crewPod } from '@dltech/atlas-plugin-crew/pod'
import { definePlugin } from '@dltech/atlas-plugin-sdk'

export const crew = definePlugin({
  name: 'crew',
  ...crewCoreSlots,
  pod: crewPod,
  control: crewControl,
  client: crewClient,
  transport: 'none',
})
```

## Rules

- Register the plugin with `definePlugin`. The function throws `MissingPluginSlotError` when a slot is absent.
- Import `@dltech/atlas-plugin-crew/pod` in the pod only. The tools read the filesystem and the ports.
- A sub-agent cannot start or steer other sub-agents. It reaches them and its parent with
  `send_message`, which the `sessions` plugin declares.
- A worktree name creates a branch and a worktree under `.atlas/worktrees`. A path adopts a worktree that git already lists.

## See also

- [The v2 package map](../../docs/decisions/0019-v2-package-map.md)
- [`packages/plugin-sdk/src/slots.ts`](../../packages/plugin-sdk/src/slots.ts)
- [`CONTEXT.md`](../../CONTEXT.md): the names session, thread, sub-agent and teammate
