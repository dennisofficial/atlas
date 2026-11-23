import {
  EHeldAction,
  EResume,
  INBOX_KIND_RETRY,
  NO_WORKSPACE_RECORD,
  decideHeldAction,
  isResumablePlan,
  loopStateOf,
  preparedBeforeOf,
  repairHoldsResume,
  resumePlanOf,
  setupInFlightOf,
  workspaceStateFrom,
  type InboxEntry,
  type PrepareFailure,
  type ThreadId,
} from '@dltech/atlas-core'

import { forMainThread } from './child-retry'
import { heldEndingIdsOf } from './held-endings'
import { idleReleaseDue } from './held-idle'
import { countRunningShells } from './held-shells'
import {
  actionableEntries,
  isStop,
  logPendingInputIdsOf,
  readFullInbox,
  stopSettledPromptOf,
  understandsCommand,
  waitingInputIdsOf,
} from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

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
}): Promise<{
  entries: InboxEntry[]
  action: EHeldAction
  resumable: boolean
  inboxHead: number
  shellsRunning: boolean
  failure: PrepareFailure | undefined
  preparedBefore: boolean
}> => {
  const { deps } = args
  const cache = args.record?.eventCache()
  const events = cache?.eventsAfter(0) ?? []
  const resumeEvents = cache?.loopEventsAfter(args.resumeAfterSeq) ?? []
  const entries = await readFullInbox(deps)
  const resolvable = forMainThread(entries.filter((entry) => understandsCommand(deps, entry)))
  const logIds = logPendingInputIdsOf(events)
  const preparedBefore = preparedBeforeOf(events)
  const workspace = workspaceStateFrom({
    record: args.record?.eventCache().bookkeeping().workspace() ?? NO_WORKSPACE_RECORD,
    preparing: args.preparing,
    pendingMessageIds: [
      ...resolvable.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
      ...logIds,
    ],
  })
  const actionable = actionableEntries({ entries: resolvable, failure: workspace.failure })
  const heldEndings = heldEndingIdsOf({
    entries: actionable.filter((entry) => !isStop(entry)),
    recordEvents: events,
    childrenRunning: args.childrenRunning,
  })
  const messagePending =
    actionable.some((entry) => !isStop(entry) && !heldEndings.has(entry.inboxId)) ||
    waitingInputIdsOf({
      ids: logIds.filter((id) => !heldEndings.has(id)),
      failure: workspace.failure,
    }).length > 0
  const quiet = idleReleaseDue({
    turnRunning: args.turnRunning,
    runtime: args.runtime,
    pendingInput: messagePending,
    runningShells: 0,
    runningChildren: args.childrenRunning,
    terminalStreams: args.runtime?.terminalStreams?.() ?? 0,
    panelHolds: args.runtime?.panelHolds?.() ?? 0,
  })
  const runningShells =
    quiet && args.runtime !== undefined
      ? await countRunningShells({ deps, runtime: args.runtime })
      : 0
  const plan = resumePlanOf(loopStateOf({ events: resumeEvents }))
  const retryPending = actionable.some((entry) => entry.kind === INBOX_KIND_RETRY)
  const repairHeld = repairHoldsResume({ mainThreadId: args.threadId, events })
  const resumable =
    !stopSettledPromptOf(events) &&
    (repairHeld ? retryPending && plan.kind === EResume.Continue : isResumablePlan(plan))
  const action = resumeSetupIn({
    decided: decideHeldAction({
      draining: args.draining,
      turn: args.turnRunning ? 'running' : 'idle',
      stopPending: actionable.some(isStop),
      messagePending,
      resumable,
      workspace: workspace.state,
      preparedBefore,
      retryPending: workspace.retryPending,
      idleDue: quiet && runningShells === 0 && args.childrenRunning === 0 && !args.setupRunning,
    }),
    setupInFlight: setupInFlightOf(events),
    preparing: args.preparing,
    setupRunning: args.setupRunning,
  })
  return {
    entries,
    action,
    resumable,
    inboxHead: Math.max(0, ...entries.map((entry) => entry.inboxId)),
    shellsRunning: runningShells > 0,
    failure: workspace.failure,
    preparedBefore,
  }
}
