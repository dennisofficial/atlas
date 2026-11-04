import type { ThreadId } from '@dltech/atlas-core'
import { HookChain, HookedToolDispatcher, LoopTurnRunner } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'

import { ScopedToolDispatcher } from '../calls/call-scope'
import { BranchObserver } from './branch-observer'
import type { HeldSessionDeps } from './held-session-deps'
import { LeaseLostError } from './record/record-adapter'
import type { HeldTurns } from './held-turns'
import { InboxIntake } from './inbox-intake'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'
import { V2OnceLedger } from './record/v2-once-ledger'
import { retryDepsFromTimers } from './timer-sleep'

export const logDriveFault = (args: { deps: HeldSessionDeps; error: unknown }): void => {
  if (args.error instanceof LeaseLostError) return
  args.deps.log?.error({
    source: 'holder.session',
    message: `session ${args.deps.sessionId} faulted`,
    ...logFieldsOf({ error: args.error }),
  })
}

export const logReconcileFault = (args: { deps: HeldSessionDeps; error: unknown }): void => {
  if (args.error instanceof LeaseLostError) return
  args.deps.log?.error({
    source: 'holder.session',
    message: `reconciling ${args.deps.sessionId} failed`,
    ...logFieldsOf({ error: args.error }),
  })
}

export const createBranchObserver = (args: {
  deps: HeldSessionDeps
  record: SessionRecord
  runtime: SessionRuntime
  threadId: ThreadId
  signal: AbortSignal
}): BranchObserver => {
  const { deps, record, runtime, threadId } = args
  return new BranchObserver({
    record: {
      append: ({ threadId: to, runId, body }) =>
        record.append({ threadId: to, runId, drafts: [body] }),
      events: () => record.eventCache().all(),
    },
    remoteCalls: runtime.remoteCalls,
    threadId,
    repos: () => runtime.watchedRepos(),
    runId: () => deps.ids.nextRunId(),
    signal: args.signal,
    ...(deps.log === undefined ? {} : { log: deps.log }),
  })
}

export const createLoopRunner = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  turns: HeldTurns
  threadId: ThreadId
  isModelOnlyDrain(): boolean
}): LoopTurnRunner => {
  const { deps, runtime, record, threadId } = args
  const intake = new InboxIntake({
    plane: deps.plane,
    sessionId: deps.sessionId,
    record,
    threadId,
    runId: () => deps.ids.nextRunId(),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  })
  return new LoopTurnRunner({
    record,
    modelContext: record,
    model: runtime.model,
    ids: deps.ids,
    assembly: runtime.assembly,
    tools: () => runtime.tools.declarations(),
    dispatch: new ScopedToolDispatcher(
      new HookedToolDispatcher({ registry: runtime.tools, hooks: new HookChain({}) }),
    ),
    intake,
    output: args.turns.liveOutput(),
    detachTool: (tool) => args.isModelOnlyDrain() && runtime.daemonTools.has(tool),
    launchDirectory: runtime.launchDirectory,
    normalizeFailure: runtime.normalizeFailure,
    retry: retryDepsFromTimers(deps.timers),
    onceLedger: new V2OnceLedger({
      cache: record.eventCache(),
      record,
      threadId,
      runId: () => deps.ids.nextRunId(),
    }),
  })
}
