import { drainWantsHolder, isResumable, workspaceStateOf } from '@dltech/atlas-core'

import { actionableEntries, isStop, readFullInbox } from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRecord } from './record/record-adapter'

export const drainNeedsHolder = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  turnRunning: boolean
}): Promise<boolean> => {
  const events = args.record?.eventCache().all() ?? []
  try {
    const entries = await readFullInbox(args.deps)
    const workspace = workspaceStateOf({
      events,
      preparing: false,
      pendingMessageIds: entries.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
    })
    return drainWantsHolder({
      turn: args.turnRunning ? 'running' : 'idle',
      resumable: isResumable(args.record?.eventCache().visibleLoopEvents() ?? []),
      messagePending: actionableEntries({ entries, failure: workspace.failure }).length > 0,
      workspace: workspace.state,
      retryPending: workspace.retryPending,
    })
  } catch {
    return true
  }
}
