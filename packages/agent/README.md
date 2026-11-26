# @dltech/atlas-agent

The loop that every agent runs: one turn, its steps, its tool calls, its retries and its ending.
A main agent, a sub-agent and a teammate all run this loop. It knows nothing of pods or leases.

## Owns

- The turn runner: `say`, `runTurn` and `resume`, and the outcome of each.
- The step loop: the model step, the chunk stream, the loop guard, the retry and the recovery.
- Tool dispatch and the tool registry, including the capture that an after-tool hook asks for.
- The hook chain: the order of hooks and the budget of each phase.
- Intake: how a pending input becomes part of the next step.
- The trace of a turn: the root span, and one span for each collaborator that the loop calls.
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
- `TurnDeps`: the record, the model, the ids, the assembly, the tools, the hooks and the tracer.
- `TurnOutcome`, `ETurnStatus`: how a turn ends: `completed`, `paused`, `idle`, `interrupted`,
  `failed`, `waiting-for-model`, `parked` or `relocation-paused`.
- `PauseSignal`: pause a running turn at the next step boundary. `say`, `runTurn` and `resume` take it
  as `pause`; a paused turn ends `relocation-paused`.
- `TurnDeps.uploads`: a `SaidUploadsPort` places the files of a said message on disk. The loop asks it only for the files the log holds no placement fact for, and appends one `upload-placement` fact per placed file through `AgentRecordPort.appendFacts`.

### Trace a turn

- `tracedTurnDeps(deps)`: wraps the model, the record, the retry, the intake and the loop watch of
  a `TurnDeps`, so each call is a span. It returns the deps unchanged when `deps.trace` is absent.
- `traceTurn({ trace, model, record, threadId, entry, firstToken, run })`: runs one turn as the
  root `turn` span. `entry` is `ETurnEntry.Start` or `ETurnEntry.Resume`.
- `TurnDeps.trace`, `TurnDeps.firstToken`: the tracer, and the clock that stamps `firstTokenMs` on
  the turn span.

### Order the hooks

- `new HookChain({...})`: run the hooks of one phase in order, within their budget.
- `HookChainArgs`: the hooks of each phase: `beforeTurn`, `beforeStep`, `beforeRequest`,
  `beforeTool`, `afterTool`, `afterShell`, `onChunk`, `afterTurn`, `onThreadOpen`.
- `EHookPhase`, `RegisteredHook`, `Bounds`: the phase names, one registered hook, and the limits.
- `AfterToolHook`: a registered `afterTool` hook with an optional async `capturesFileChanges({call,
  signal})` predicate. `HookChain.capturesFileChanges({call, signal})` answers whether any hook
  wants the tool to capture the file's before and after, under the same budget as the hooks; a
  predicate that throws or overruns counts as no.

### Dispatch a tool call

- `ToolRegistry`, `InMemoryToolRegistry`: find a tool by name and declare it to the model.
- `filteredToolRegistry({registry, allow, deny})`: a registry that hides some tools.
- `ToolDispatcher`: the abstract dispatcher. `HookedToolDispatcher` runs the hook phases around
  each call, and asks the tool to capture file changes when an after-tool hook wants them.
- `DispatchArgs`, `DispatchableCall`: what a dispatcher receives for one call.
- `TurnDeps.onceLedger`: an `OnceLedger` runs one keyed decision once, so a retry does not repeat it.

### Take in an input

- `AgentIntake`: `prepare({threadId})` returns the pending drain, and an optional `subscribe`.
- `composeIntake(sources)`: merge several intake sources into one.
- `PendingDrain`: the drafts, the wake flag and the optional `acknowledge` and `release` of a drain.

### Record the spend and the failure

- `TurnLedgerPort`, `TurnSpend`: record what a turn cost.
- `ModelStreamError`, `StreamStallError`, `MessageConversionError`, `ModelAdmissionBlockedError`:
  the failures a provider raises.
- `TurnFault`, `causeChainOf(error)`, `runFailureWith({...})`: name the failure for the record.
- `NormalizeFailure`: how a provider error becomes a `RunFailure`. `TurnDeps` requires one.
- `safeFailureMessage(message)`, `blockedFailureOf(chain)`: remove secrets from a provider message,
  and find an admission block in a cause chain.
- `OPERATOR_STOP_REASON`: the abort reason that marks a turn stopped by the operator.
- `guardRepeatLoop({...})`, `MAX_LOOP_CUTS_PER_TURN`: stop a loop that repeats itself.

### Settle and report

- `settleCrashedCalls({record, ids, threadId, settleOf})`, `ECrashedCall`, `CrashedCallSettle`: record
  an interrupted result for a call a restart left open when the host says to interrupt it; a call the
  host holds stays open, and the replay decides it from the daemon's answer.
- `AgentOutput`, `AgentOutputEvent`, `StepStreamEvent`, `StepKey`: report each step, chunk and tool
  output to a surface.

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
- Do not read the filesystem or the network here. Add a port to `TurnDeps` instead.
- Do not write to the log directly. Every draft goes through `AgentRecordPort`.

## See also

- [docs/decisions/0021-v2-loop-runs-on-the-agent-host.md](../../docs/decisions/0021-v2-loop-runs-on-the-agent-host.md).
- [docs/architecture.md](../../docs/architecture.md) for the port and adapter rules.
