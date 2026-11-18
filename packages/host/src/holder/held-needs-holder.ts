import {
  NO_WORKSPACE_RECORD,
  drainWantsHolder,
  initialLoopState,
  isResumableOf,
  workspaceStateFrom,
} from '@dltech/atlas-core'

import {
  actionableEntries,
  isStop,
  logPendingMessageIdsOf,
  readFullInbox,
  understandsCommand,
  waitingInputIdsOf,
} from './held-inbox'
import { openChildrenOf } from './crew/open-children'
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
    const logIds = logPendingMessageIdsOf(cache?.eventsAfter(0) ?? [])
    const workspace = workspaceStateFrom({
      record: cache?.bookkeeping().workspace() ?? NO_WORKSPACE_RECORD,
      preparing: false,
      pendingMessageIds: [
        ...entries.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
        ...logIds,
      ],
    })
    return drainWantsHolder({
      turn: args.turnRunning ? 'running' : 'idle',
      childrenRunning: openChildrenOf(cache?.visibleLoopEvents() ?? []).length > 0,
      resumable: isResumableOf(cache?.loopState() ?? initialLoopState()),
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
