import {
  EHeldAction,
  EResume,
  INBOX_KIND_RETRY,
  NO_WORKSPACE_RECORD,
  decideHeldAction,
  isMessageInputKind,
  isResumablePlan,
  lostShellsOf,
  loopStateOf,
  pendingInputsOf,
  pendingMessagesOf,
  preparedBeforeOf,
  repairHoldsResume,
  resumePlanOf,
  setupInFlightOf,
  workspaceStateFrom,
  type InboxEntry,
  type PrepareFailure,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'

import { forMainThread } from './child-retry'
import { heldEndingIdsOf } from './held-endings'
import { idleReleaseDue } from './held-idle'
import { countRunningShells, shellHoldOf } from './held-shells'
import {
  actionableEntries,
  carriesPodResized,
  isBookkeepingEntry,
  isCommandEntry,
  isInterrupt,
  isNoticeEntry,
  isStop,
  logPendingInputIdsOf,
  logPendingNoticeIdsOf,
  podResizedNoticeIdsOf,
  queuedPromptAtOf,
  readFullInbox,
  stopSettledPromptOf,
  takesTurnEntry,
  understandsCommand,
  waitingInputIdsOf,
} from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'
import { podParkedOf } from './pod-park'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

const startsNoTurn = (entry: InboxEntry): boolean => isInterrupt(entry) || carriesPodResized(entry)

const IDLE_WHILE_SETUP_RUNS: readonly EHeldAction[] = [
  EHeldAction.StartTurn,
  EHeldAction.Wait,
  EHeldAction.Release,
]

/**
 * A setup script that started before the last handoff is still running on the pod: the holder
 * has to re-join it (Prepare) before it may start a turn, wait, or release the pod — releasing
 * would take the sandbox away under the running script.
 */
const resumeSetupIn = (args: {
  decided: EHeldAction
  setupInFlight: boolean
  preparing: boolean
  setupRunning: boolean
}): EHeldAction =>
  args.setupInFlight &&
  !args.preparing &&
  !args.setupRunning &&
  IDLE_WHILE_SETUP_RUNS.includes(args.decided)
    ? EHeldAction.Prepare
    : args.decided

export const readHeldAction = async (args: {
  deps: HeldSessionDeps
  threadId: ThreadId
  draining: boolean
  turnRunning: boolean
  resumeAfterSeq: number
  runtime: SessionRuntime | undefined
  record: SessionRecord | undefined
  preparing: boolean
  setupRunning: boolean
  childrenRunning: number
  shellsOwedSince: number | undefined
}): Promise<{
  entries: InboxEntry[]
  action: EHeldAction
  resumable: boolean
  inboxHead: number
  shellsRunning: boolean
  shellsOwedSince: number | undefined
  failure: PrepareFailure | undefined
  preparedBefore: boolean
  promptWaiting: boolean
  queuedAt: string | undefined
}> => {
  const { deps } = args
  const cache = args.record?.eventCache()
  const events = cache?.eventsAfter(0) ?? []
  const resumeEvents = cache?.loopEventsAfter(args.resumeAfterSeq) ?? []
  const entries = await readFullInbox(deps)
  const resolvable = forMainThread(entries.filter((entry) => understandsCommand(deps, entry)))
  const logIds = logPendingInputIdsOf(events).filter((id) => !podResizedNoticeIdsOf(events).has(id))
  const preparedBefore = preparedBeforeOf(events)
  const workspace = workspaceStateFrom({
    record: args.record?.eventCache().bookkeeping().workspace() ?? NO_WORKSPACE_RECORD,
    preparing: args.preparing,
    pendingMessageIds: [
      ...resolvable.filter((entry) => !startsNoTurn(entry)).map((entry) => entry.inboxId),
      ...logIds,
    ],
  })
  const actionable = actionableEntries({ entries: resolvable, failure: workspace.failure })
  const heldEndings = heldEndingIdsOf({
    entries: actionable.filter((entry) => !isInterrupt(entry)),
    recordEvents: events,
    childrenRunning: args.childrenRunning,
  })
  const promptWaiting =
    actionable.some((entry) => isMessageInputKind(entry.kind) && !heldEndings.has(entry.inboxId)) ||
    waitingInputIdsOf({
      ids: pendingMessagesOf(pendingInputsOf(events))
        .map((input) => input.inboxId)
        .filter((id) => !heldEndings.has(id)),
      failure: workspace.failure,
    }).length > 0
  const repairHeld = repairHoldsResume({ mainThreadId: args.threadId, events })
  const noticeIds = new Set(repairHeld ? logPendingNoticeIdsOf(events) : [])
  const messagePending =
    actionable.some(
      (entry) =>
        takesTurnEntry(entry) &&
        !isCommandEntry(entry) &&
        !startsNoTurn(entry) &&
        !heldEndings.has(entry.inboxId) &&
        !(repairHeld && isNoticeEntry(entry)),
    ) ||
    waitingInputIdsOf({
      ids: logIds.filter((id) => !noticeIds.has(id) && !heldEndings.has(id)),
      failure: workspace.failure,
    }).length > 0
  const bookkeepingPending = actionable.some(
    (entry) => isBookkeepingEntry(entry) && !startsNoTurn(entry) && !heldEndings.has(entry.inboxId),
  )
  const commandPending = actionable.some(
    (entry) => isCommandEntry(entry) && !heldEndings.has(entry.inboxId),
  )
  const quiet = idleReleaseDue({
    turnRunning: args.turnRunning,
    runtime: args.runtime,
    pendingInput: messagePending || commandPending,
    runningShells: 0,
    runningChildren: args.childrenRunning,
    terminalStreams: args.runtime?.terminalStreams?.() ?? 0,
    panelHolds: args.runtime?.panelHolds?.() ?? 0,
  })
  const hold =
    quiet && args.runtime !== undefined
      ? shellHoldOf({
          counted: await countRunningShells({ deps, runtime: args.runtime }),
          openInLog: lostShellsOf(events as readonly Event[]).length,
          owedSince: args.shellsOwedSince,
          now: deps.timers.now(),
        })
      : { holding: 0, owedSince: undefined }
  const runningShells = hold.holding
  const plan = resumePlanOf(loopStateOf({ events: resumeEvents }))
  const retryPending = actionable.some((entry) => entry.kind === INBOX_KIND_RETRY)
  const parked = args.turnRunning
    ? false
    : await podParkedOf({ plane: deps.plane, sessionId: deps.sessionId })
  const resumable =
    !stopSettledPromptOf(events) &&
    (repairHeld ? retryPending && plan.kind === EResume.Continue : isResumablePlan(plan))
  const action = resumeSetupIn({
    decided: decideHeldAction({
      draining: args.draining,
      turn: args.turnRunning ? 'running' : 'idle',
      stopPending: actionable.some(isStop),
      messagePending,
      bookkeepingPending,
      resumable,
      parked,
      workspace: workspace.state,
      preparedBefore,
      retryPending: workspace.retryPending,
      idleDue: quiet && runningShells === 0 && args.childrenRunning === 0 && !args.setupRunning,
    }),
    setupInFlight: setupInFlightOf(events) && !parked,
    preparing: args.preparing,
    setupRunning: args.setupRunning,
  })
  return {
    entries,
    action,
    resumable,
    inboxHead: Math.max(0, ...entries.map((entry) => entry.inboxId)),
    shellsRunning: runningShells > 0,
    shellsOwedSince: hold.owedSince,
    failure: workspace.failure,
    preparedBefore,
    promptWaiting,
    queuedAt: queuedPromptAtOf({ entries, events, threadId: args.threadId }),
  }
}
