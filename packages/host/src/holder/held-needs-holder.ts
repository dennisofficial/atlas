import {
  NO_WORKSPACE_RECORD,
  drainWantsHolder,
  initialLoopState,
  isResumableOf,
  setupInFlightOf,
  workspaceStateFrom,
} from '@dltech/atlas-core'

import {
  actionableEntries,
  isStop,
  logPendingInputIdsOf,
  readFullInbox,
  stopSettledPromptOf,
  understandsCommand,
  waitingInputIdsOf,
} from './held-inbox'
import { childrenAtWorkOf, spawnedChildrenOf } from './crew/open-children'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRecord } from './record/record-adapter'

export const drainNeedsHolder = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  turnRunning: boolean
}): Promise<boolean> => {
  const cache = args.record?.eventCache()
  try {
    const entries = (await readFullInbox(args.deps)).filter((entry) =>
      understandsCommand(args.deps, entry),
    )
    const events = cache?.eventsAfter(0) ?? []
    if (setupInFlightOf(events)) return true
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
    const state = cache?.loopState() ?? initialLoopState()
    return drainWantsHolder({
      turn: args.turnRunning ? 'running' : 'idle',
      childrenRunning:
        (await childrenAtWorkOf({
          plane: args.deps.plane,
          sessionId: args.deps.sessionId,
          children,
        })) > 0,
      resumable: isResumableOf(state) && !stopSettledPromptOf(events),
      messagePending:
        actionableEntries({ entries, failure: workspace.failure }).length > 0 ||
        waitingInputIdsOf({ ids: logIds, failure: workspace.failure }).length > 0,
      workspace: workspace.state,
      retryPending: workspace.retryPending,
    })
  } catch {
    return true
  }
}
