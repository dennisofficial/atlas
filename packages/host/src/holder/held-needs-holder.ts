import {
  NO_WORKSPACE_RECORD,
  drainWantsHolder,
  initialLoopState,
  isResumableOf,
  workspaceStateFrom,
} from '@dltech/atlas-core'

import { actionableEntries, isStop, readFullInbox, understandsCommand } from './held-inbox'
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
    const workspace = workspaceStateFrom({
      record: cache?.bookkeeping().workspace() ?? NO_WORKSPACE_RECORD,
      preparing: false,
      pendingMessageIds: entries.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
    })
    return drainWantsHolder({
      turn: args.turnRunning ? 'running' : 'idle',
      resumable: isResumableOf(cache?.loopState() ?? initialLoopState()),
      messagePending: actionableEntries({ entries, failure: workspace.failure }).length > 0,
      workspace: workspace.state,
      retryPending: workspace.retryPending,
    })
  } catch {
    return true
  }
}
