import { EToolEffect, isResumableOf, type ThreadId } from '@dltech/atlas-core'
import {
  HookChain,
  HookedToolDispatcher,
  LoopTurnRunner,
  type PauseSignal,
  settleCrashedCalls,
} from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'

import { ScopedToolDispatcher } from '../calls/call-scope'
import { BranchObserver } from './branch-observer'
import { PrLinker } from './pr-linker'
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

export const startHeldTurn = (args: {
  deps: HeldSessionDeps
  turns: HeldTurns
  pause: PauseSignal
  runner: LoopTurnRunner
  threadId: ThreadId
  resume: boolean
  onActivity(): void
  refreshBranches(): void
  onFault(): void
  onSettled(): void
}): void => {
  void args.turns
    .drive({
      runner: args.runner,
      threadId: args.threadId,
      pause: args.pause,
      resume: args.resume,
      onActivity: args.onActivity,
    })
    .then(() => {
      args.refreshBranches()
    })
    .catch((error) => {
      logDriveFault({ deps: args.deps, error })
      args.onFault()
    })
    .finally(() => {
      args.onSettled()
    })
}

export const settleAndCheckResume = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
}): Promise<boolean> => {
  const { deps, runtime, record, threadId } = args
  await settleCrashedCalls({
    record,
    ids: deps.ids,
    threadId,
    effectOf: (name) => (runtime.daemonTools.has(name) ? EToolEffect.Read : runtime.effectOf(name)),
  })
  return isResumableOf(await record.loopState({ threadId }))
}

export const createBranchObserver = (args: {
  deps: HeldSessionDeps
  record: SessionRecord
  runtime: SessionRuntime
  threadId: ThreadId
  signal: AbortSignal
}): BranchObserver => {
  const { deps, record, runtime, threadId } = args
  const book = () => record.eventCache().bookkeeping()
  const runId = () => deps.ids.nextRunId()
  const linker =
    runtime.pullRequests === undefined
      ? undefined
      : new PrLinker({
          source: runtime.pullRequests,
          record: {
            append: ({ threadId: to, runId: id, body }) =>
              record.append({ threadId: to, runId: id, drafts: [body] }),
            lastObservation: (repo) => book().lastObservation(repo),
            hasLink: (link) => book().hasLink(link),
          },
          threadId,
          signal: args.signal,
          repos: () => runtime.watchedRepos(),
          runId,
          ...(deps.log === undefined ? {} : { log: deps.log }),
        })
  return new BranchObserver({
    record: {
      append: ({ threadId: to, runId: id, body }) =>
        record.append({ threadId: to, runId: id, drafts: [body] }),
      lastObservation: (repo) => book().lastObservation(repo),
      recordedBase: (repo) => {
        const fact = book().fact(`base:${repo}`)
        return fact.found && typeof fact.value === 'string' ? fact.value : undefined
      },
      rememberBase: ({ threadId: to, runId: id, repo, base }) =>
        record.append({
          threadId: to,
          runId: id,
          drafts: [
            {
              type: 'fact-recorded',
              key: `base:${repo}`,
              kind: 'base',
              value: base,
            },
          ],
        }),
    },
    remoteCalls: runtime.remoteCalls,
    threadId,
    repos: () => runtime.watchedRepos(),
    baseOf: (repo) => runtime.baseBranchOf(repo),
    afterRefresh: linker === undefined ? undefined : () => linker.link(),
    runId,
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
  epoch: number
  isModelOnlyDrain(): boolean
}): LoopTurnRunner => {
  const { deps, runtime, record, threadId } = args
  const intake = new InboxIntake({
    plane: deps.plane,
    sessionId: deps.sessionId,
    record,
    threadId,
    runId: () => deps.ids.nextRunId(),
    commands: deps.commands,
    handlers: deps.commandHandlers,
    model: runtime.model,
    now: () => deps.timers.now(),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  })
  return new LoopTurnRunner({
    record,
    modelContext: record,
    model: runtime.model,
    ids: deps.ids,
    assembly: runtime.assembly,
    ...(runtime.uploads === undefined ? {} : { uploads: runtime.uploads }),
    tools: () => runtime.tools.declarations(),
    dispatch: new ScopedToolDispatcher(
      new HookedToolDispatcher({
        registry: runtime.tools,
        hooks: new HookChain({}),
      }),
    ),
    intake,
    output: args.turns.liveOutput({
      headSeq: () => record.eventCache().currentHead().seq,
      epoch: args.epoch,
    }),
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

export const wireHeldLoop = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  turns: HeldTurns
  threadId: ThreadId
  signal: AbortSignal
  epoch: number
  isModelOnlyDrain(): boolean
}): { runner: LoopTurnRunner; branches: BranchObserver } => {
  const runner = createLoopRunner(args)
  const branches = createBranchObserver(args)
  branches.start()
  return { runner, branches }
}
