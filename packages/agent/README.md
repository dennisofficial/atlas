# @dltech/atlas-agent

The loop that every agent runs: one turn, its steps, its tool calls, its retries and its ending.
A main agent, a sub-agent and a teammate all run this loop. It knows nothing of pods or leases.

## Owns

- The turn runner: `say`, `runTurn` and `resume`, and the outcome of each.
- The step loop: the model step, the chunk stream, the loop guard, the retry and the recovery.
- Tool dispatch, the tool registry, and the quality stage between a call and its result.
- The hook chain: the order of hooks and the budget of each phase.
- Intake: how a pending input becomes part of the next step.
- Turn spend, and the model failures that a turn records.

## Does not own

- The pod, the lease and the process: `@dltech/atlas-host`.
- Assembly rules, events and port contracts: `@dltech/atlas-core`.
- The tools themselves: `@dltech/atlas-plugin-sdk` plugins and the agent host.
- Persistence: a record adapter implements `AgentRecordPort`.

## Entry points

| Import                        | Use it for                                             |
| ----------------------------- | ------------------------------------------------------ |
| `@dltech/atlas-agent`         | The loop, the hook chain, dispatch, intake and errors. |
| `@dltech/atlas-agent/testing` | A scripted model, an in-memory record and fake tools.  |

## Capabilities

### Run a turn

- `LoopTurnRunner`: the runner. Construct it with `TurnDeps`.
- `TurnRunner`: the abstract port with `say`, `runTurn` and `resume`.
- `TurnDeps`: the record, the model, the ids, the assembly, the tools and the hooks.
- `TurnOutcome`, `ETurnStatus`: how a turn ends: `completed`, `paused`, `idle`, `interrupted`,
  `failed`, `waiting-for-model`, `parked` or `relocation-paused`.

### Order the hooks

- `HookChain({...})`: run the hooks of one phase in order, within their budget.
- `HookChainArgs`: the hooks of each phase: `beforeTurn`, `beforeStep`, `beforeRequest`,
  `beforeTool`, `afterTool`, `afterShell`, `onChunk`, `afterTurn`, `onThreadOpen`.
- `EHookPhase`, `RegisteredHook`, `Bounds`: the phase names, one registered hook, and the limits.

### Dispatch a tool call

- `ToolRegistry`, `InMemoryToolRegistry`: find a tool by name and declare it to the model.
- `filteredToolRegistry({registry, allow, deny})`: a registry that hides some tools.
- `ToolDispatcher`: the abstract dispatcher. `HookedToolDispatcher` runs the hook phases and the
  quality stage around each call.

### Take in an input

- `AgentIntake`: `prepare({threadId})` returns the pending drain, and an optional `subscribe`.
- `composeIntake(sources)`: merge several intake sources into one.

### Record the spend and the failure

- `TurnLedgerPort`, `TurnSpend`: record what a turn cost.
- `ModelStreamError`, `StreamStallError`, `MessageConversionError`, `ModelAdmissionBlockedError`:
  the failures a provider raises.
- `TurnFault`, `causeChainOf(error)`, `runFailureWith({...})`: name the failure for the record.
- `guardRepeatLoop({...})`, `MAX_LOOP_CUTS_PER_TURN`: stop a loop that repeats itself.

### Test the loop

- `new ScriptedModel(script, identity?, fileExists?)`, `ScriptedModelStep`: a model that answers
  with a fixed script. The optional positional arguments set the provider identity and a
  `fileExists` callback.
- `InMemoryAgentRecord`, `InMemoryModelContext`, `InMemoryIntake`, `InMemoryOnceLedger`: the
  in-memory ports a spec runs the loop against.
- `FakeTool`, `fakeToolRegistry(tools)`, `SequentialIds`: a tool and ids for a spec.

## Usage

```ts
import { defaultPipeline } from '@dltech/atlas-core'
import { LoopTurnRunner } from '@dltech/atlas-agent'

const runner = new LoopTurnRunner({
  record, // an AgentRecordPort
  modelContext: record, // a ModelContextPort
  model, // a ModelPort
  ids, // an IdPort
  assembly: defaultPipeline({ prompt, launchDirectory }),
  hooks: pod.hooks, // a HookChain, or leave it out
  launchDirectory,
  normalizeFailure, // how a provider error becomes a RunFailure
})

const outcome = await runner.say({ threadId, text: 'What changed?' })
```

## Rules

- Provide `record`, `modelContext`, `model`, `ids`, `assembly`, `launchDirectory` and
  `normalizeFailure`. `TurnDeps` requires them.
- Do not read the clock, the filesystem or the network here. Add a port to `TurnDeps` instead.
- Do not write to the log directly. Every draft goes through `AgentRecordPort`.

## See also

- [docs/decisions/0021-v2-loop-runs-on-the-agent-host.md](../../docs/decisions/0021-v2-loop-runs-on-the-agent-host.md).
- [docs/architecture.md](../../docs/architecture.md) for the port and adapter rules.
