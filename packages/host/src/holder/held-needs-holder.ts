import {
  NO_WORKSPACE_RECORD,
  drainWantsHolder,
  initialLoopState,
  isResumableOf,
  lostShellsOf,
  repairHoldsResume,
  setupInFlightOf,
  commandInputName,
  producesOutcome,
  unfinishedCommandIdsOf,
  visibleEvents,
  workspaceStateFrom,
  type Event,
  type RecordEvent,
} from '@dltech/atlas-core'

import {
  actionableEntries,
  isCommandEntry,
  isNoticeEntry,
  isStop,
  logPendingInputIdsOf,
  logPendingNoticeIdsOf,
  readFullInbox,
  stopSettledPromptOf,
  understandsCommand,
  waitingInputIdsOf,
} from './held-inbox'
import { childrenAtWorkOf } from './crew/child-reads'
import { spawnedChildrenOf } from './crew/open-children'
import type { HeldSessionDeps } from './held-session-deps'
import { podParkedOf } from './pod-park'
import type { SessionRecord } from './record/record-adapter'

export const outcomeCommandPending = async (args: {
  events: readonly RecordEvent[]
  kindOf(inboxId: number): Promise<string | undefined>
}): Promise<boolean> => {
  for (const inboxId of unfinishedCommandIdsOf(visibleEvents(args.events))) {
    const kind = await args.kindOf(inboxId)
    if (kind !== undefined && producesOutcome(commandInputName(kind))) return true
  }
  return false
}

export const drainNeedsHolder = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  turnRunning: boolean
}): Promise<boolean> => {
  const cache = args.record?.eventCache()
  try {
    const parked = args.turnRunning
      ? false
      : await podParkedOf({ plane: args.deps.plane, sessionId: args.deps.sessionId })
    const entries = (await readFullInbox(args.deps)).filter((entry) =>
      understandsCommand(args.deps, entry),
    )
    const events = cache?.eventsAfter(0) ?? []
    if (!parked && setupInFlightOf(events)) return true
    const logIds = logPendingInputIdsOf(events)
    const workspace = workspaceStateFrom({
      record: cache?.bookkeeping().workspace() ?? NO_WORKSPACE_RECORD,
      preparing: false,
      pendingMessageIds: [
        ...entries.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
        ...logIds,
      ],
    })
    const children = spawnedChildrenOf(cache?.visibleLoopEvents() ?? [])
    const actionable = actionableEntries({ entries, failure: workspace.failure })
    const state = cache?.loopState() ?? initialLoopState()
    const repairHeld =
      cache !== undefined && repairHoldsResume({ mainThreadId: cache.threadId(), events })
    const noticeIds = new Set(repairHeld ? logPendingNoticeIdsOf(events) : [])
    return drainWantsHolder({
      turn: args.turnRunning ? 'running' : 'idle',
      parked,
      childrenRunning:
        (await childrenAtWorkOf({
          plane: args.deps.plane,
          sessionId: args.deps.sessionId,
          children,
        })) > 0,
      shellsOpen: lostShellsOf(events as readonly Event[]).length > 0,
      resumable: isResumableOf(state) && !stopSettledPromptOf(events) && !repairHeld,
      messagePending:
        actionable.some(
          (entry) => !isCommandEntry(entry) && !(repairHeld && isNoticeEntry(entry)),
        ) ||
        waitingInputIdsOf({
          ids: logIds.filter((id) => !noticeIds.has(id)),
          failure: workspace.failure,
        }).length > 0,
      commandPending: actionable.some(isCommandEntry),
      workspace: workspace.state,
      retryPending: workspace.retryPending,
    })
  } catch {
    return true
  }
}
