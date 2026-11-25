import {
  EHeldAction,
  EToolEffect,
  isResumableOf,
  modelFacingDeclarationsOf,
  type InboxEntry,
  type ThreadId,
} from '@dltech/atlas-core'
import { LoopTurnRunner, settleCrashedCalls } from '@dltech/atlas-agent'
import { logFieldsOf } from '@dltech/atlas-observability'
import { composePodCommands } from '@dltech/atlas-plugin-sdk'

import { ScopedToolDispatcher } from '../calls/call-scope'
import { BranchObserver } from './branch-observer'
import { oomObserverOf, type OomObserver } from './oom-observer'
import { hookedToolsOf } from './hooked-tools'
import { pluginPodOf } from './plugin-pod'
import type { HeldSessionDeps } from './held-session-deps'
import { LeaseLostError } from './record/record-adapter'
import type { HeldTurns } from './held-turns'
import { InboxIntake } from './inbox-intake'
import { EIntakeScope } from './intake-scope'
import { openChildren, type OpenChild } from './crew/open-children'
import { modelWaitObserverOf } from './model-wait-observer'
import { operatorAnswersOf } from './operator-answer'
import type { PodCrew } from '@dltech/atlas-plugin-sdk'

import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'
import { RecordOnceLedger } from './record/record-once-ledger'
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

const IDLE_COMMAND_ACTIONS: readonly EHeldAction[] = [
  EHeldAction.StartTurn,
  EHeldAction.Wait,
  EHeldAction.Release,
]

export const ranQueuedCommand = async (args: {
  action: EHeldAction
  entries: readonly InboxEntry[]
  turnRunning: boolean
  runCommands?: ((entries: readonly InboxEntry[]) => Promise<boolean>) | undefined
}): Promise<boolean> => {
  if (args.turnRunning || !IDLE_COMMAND_ACTIONS.includes(args.action)) return false
  return (await args.runCommands?.(args.entries)) === true
}

export const settleAndCheckResume = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
  crew: { adoptAll(children: readonly OpenChild[]): Promise<void> }
}): Promise<boolean> => {
  const { deps, runtime, record, threadId } = args
  await settleCrashedCalls({
    record,
    ids: deps.ids,
    threadId,
    effectOf: (name) => (runtime.daemonTools.has(name) ? EToolEffect.Read : runtime.effectOf(name)),
  })
  await args.crew.adoptAll(
    await openChildren({ record, plane: deps.plane, sessionId: deps.sessionId, threadId }),
  )
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
  return new BranchObserver({
    record: {
      append: ({ threadId: to, runId: id, body }) =>
        record.append({ threadId: to, runId: id, drafts: [body] }),
      lastObservation: (repo) => {
        const last = record
          .eventCache()
          .eventsAfter(0)
          .findLast((event) => event.type === 'branches-observed' && event.repo === repo)
        return last?.type === 'branches-observed' ? last : undefined
      },
      recordedBase: (repo) => {
        const fact = book().fact(`base:${repo}`)
        return fact.found && typeof fact.value === 'string' ? fact.value : undefined
      },
      hasObservation: () =>
        record
          .eventCache()
          .eventsAfter(0)
          .some((event) => event.type === 'branches-observed'),
    },
    remoteCalls: runtime.remoteCalls,
    threadId,
    repos: () => runtime.watchedRepos(),
    onRepo: runtime.onRepo,
    baseOf: (repo) => runtime.baseBranchOf(repo),
    runId,
    signal: args.signal,
    timers: deps.timers,
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
  signal: AbortSignal
  crew: PodCrew
  crewRunning(): number
  isDraining(): boolean
  childrenRunning(): number
}): { runner: LoopTurnRunner; intake: InboxIntake } => {
  const { deps, runtime, record, threadId } = args
  const operator =
    deps.operator === undefined
      ? undefined
      : operatorAnswersOf({
          calls: runtime.remoteCalls,
          sessionId: deps.sessionId,
          threadId,
          sessionDir: deps.operator.sessionDir,
          openValue: deps.operator.openValue,
          record,
          newRunId: () => deps.ids.nextRunId(),
        })
  const pod = pluginPodOf({
    deps,
    runtime,
    record,
    threadId,
    signal: args.signal,
    crew: args.crew,
  })
  const podCommands = composePodCommands({ factories: deps.podCommands ?? [], ctx: pod.ctx })
  const intake = new InboxIntake({
    plane: deps.plane,
    sessionId: deps.sessionId,
    record,
    threadId,
    runId: () => deps.ids.nextRunId(),
    scope: EIntakeScope.Main,
    commands: deps.commands,
    handlers: new Map([...(deps.commandHandlers ?? []), ...podCommands]),
    controlHandlers: deps.controlHandlers,
    ...(pod.slash === undefined ? {} : { slash: pod.slash }),
    model: runtime.model,
    childrenRunning: args.childrenRunning,
    ...(operator === undefined ? {} : { operatorAnswers: operator }),
    crewRunning: () => args.crewRunning(),
    crew: args.crew,
    mainThreadId: threadId,
    now: () => deps.timers.now(),
    ...(deps.log === undefined ? {} : { log: deps.log }),
  })
  const runner = new LoopTurnRunner({
    record,
    modelContext: record,
    ...(runtime.trace === undefined ? {} : { trace: runtime.trace }),
    model: runtime.model,
    ids: deps.ids,
    assembly: runtime.assembly,
    ...(runtime.plugins === undefined ? {} : { hooks: pod.hooks }),
    ...(runtime.uploads === undefined ? {} : { uploads: runtime.uploads }),
    ...(runtime.mediaUrls === undefined ? {} : { mediaUrls: runtime.mediaUrls }),
    tools: () => modelFacingDeclarationsOf(pod.tools.declarations()),
    dispatch: new ScopedToolDispatcher(
      hookedToolsOf({
        registry: pod.tools,
        hooks: pod.hooks,
        trace: runtime.trace,
      }),
    ),
    intake,
    output: args.turns.liveOutput({
      headSeq: () => record.eventCache().currentHead().seq,
      epoch: args.epoch,
    }),
    detachTool: (tool) => args.isDraining() && runtime.daemonTools.has(tool),
    launchDirectory: runtime.launchDirectory,
    normalizeFailure: runtime.normalizeFailure,
    retry: retryDepsFromTimers(deps.timers),
    onceLedger: new RecordOnceLedger({
      cache: record.eventCache(),
      record,
      threadId,
      runId: () => deps.ids.nextRunId(),
    }),
    waitState: modelWaitObserverOf({
      record,
      threadId,
      newRunId: () => deps.ids.nextRunId(),
      ...(deps.log === undefined ? {} : { log: deps.log }),
    }),
  })
  return { runner, intake }
}

export const wireHeldLoop = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  turns: HeldTurns
  threadId: ThreadId
  signal: AbortSignal
  epoch: number
  crew: PodCrew
  crewRunning(): number
  isDraining(): boolean
  childrenRunning(): number
}): {
  runner: LoopTurnRunner
  branches: BranchObserver
  oom: OomObserver
  branchesStarted: Promise<void>
  recoverCommands(): Promise<void>
  runCommands(entries: readonly InboxEntry[]): Promise<boolean>
  logStaged(): Promise<void>
} => {
  const { runner, intake } = createLoopRunner(args)
  const branches = createBranchObserver(args)
  const oom = oomObserverOf({
    deps: args.deps,
    runtime: args.runtime,
    record: args.record,
    threadId: args.threadId,
    signal: args.signal,
  })
  oom.start()
  const prepared = () => args.record.eventCache().bookkeeping().workspace().prepared
  const branchesStarted = branches.start()
  return {
    runner,
    branches,
    oom,
    branchesStarted,
    recoverCommands: () => intake.recoverUnfinished(),
    runCommands: (entries) => intake.runCommands(entries),
    logStaged: () =>
      intake.logStaged({ willDrain: () => !args.turns.turnRunning && prepared(), prepared }),
  }
}
