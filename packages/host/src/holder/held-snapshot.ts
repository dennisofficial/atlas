import {
  EHeldAction,
  NO_WORKSPACE_RECORD,
  decideHeldAction,
  isResumableOf,
  loopStateOf,
  setupInFlightOf,
  workspaceStateFrom,
  type InboxEntry,
} from '@dltech/atlas-core'

import { idleReleaseDue } from './held-idle'
import { countRunningShells } from './held-shells'
import {
  actionableEntries,
  isStop,
  logPendingMessageIdsOf,
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
}> => {
  const { deps } = args
  const cache = args.record?.eventCache()
  const events = cache?.eventsAfter(0) ?? []
  const resumeEvents = cache?.loopEventsAfter(args.resumeAfterSeq) ?? []
  const entries = await readFullInbox(deps)
  const resolvable = entries.filter((entry) => understandsCommand(deps, entry))
  const logIds = logPendingMessageIdsOf(events)
  const workspace = workspaceStateFrom({
    record: args.record?.eventCache().bookkeeping().workspace() ?? NO_WORKSPACE_RECORD,
    preparing: args.preparing,
    pendingMessageIds: [
      ...resolvable.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
      ...logIds,
    ],
  })
  const actionable = actionableEntries({ entries: resolvable, failure: workspace.failure })
  const messagePending =
    actionable.some((entry) => !isStop(entry)) ||
    waitingInputIdsOf({ ids: logIds, failure: workspace.failure }).length > 0
  const quiet = idleReleaseDue({
    turnRunning: args.turnRunning,
    runtime: args.runtime,
    pendingInput: messagePending,
    runningShells: 0,
    runningChildren: args.childrenRunning,
  })
  const runningShells =
    quiet && args.runtime !== undefined
      ? await countRunningShells({ deps, runtime: args.runtime })
      : 0
  const state = loopStateOf({ events: resumeEvents })
  const resumable = isResumableOf(state) && !stopSettledPromptOf(events)
  const action = resumeSetupIn({
    decided: decideHeldAction({
      draining: args.draining,
      turn: args.turnRunning ? 'running' : 'idle',
      stopPending: actionable.some(isStop),
      messagePending,
      resumable,
      workspace: workspace.state,
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
  }
}
