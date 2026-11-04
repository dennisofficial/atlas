import {
  decideHeldAction,
  workspaceStateOf,
  type EHeldAction,
  type InboxEntry,
  type V2Event,
} from '@dltech/atlas-core'

import { idleReleaseDue } from './held-idle'
import { actionableEntries, isStop, readFullInbox } from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'

export const readHeldAction = async (args: {
  deps: HeldSessionDeps
  draining: boolean
  turnRunning: boolean
  resumePending: boolean
  lastActivityAt: number
  runtime: SessionRuntime | undefined
  released: boolean
  events: readonly V2Event[]
  preparing: boolean
}): Promise<{ entries: InboxEntry[]; action: EHeldAction; inboxHead: number }> => {
  const { deps } = args
  const entries = await readFullInbox(deps)
  const workspace = workspaceStateOf({
    events: args.events,
    preparing: args.preparing,
    pendingMessageIds: entries.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
  })
  const actionable = actionableEntries({ entries, failure: workspace.failure })
  const messagePending = actionable.some((entry) => !isStop(entry))
  const action = decideHeldAction({
    draining: args.draining,
    turn: args.turnRunning ? 'running' : 'idle',
    stopPending: actionable.some(isStop),
    messagePending: messagePending || args.resumePending,
    workspace: workspace.state,
    retryPending: workspace.retryPending,
    idleDue: idleReleaseDue({
      deps,
      turnRunning: args.turnRunning,
      lastActivityAt: args.lastActivityAt,
      runtime: args.runtime,
      released: args.released,
      pendingInput: messagePending,
    }),
  })
  return { entries, action, inboxHead: Math.max(0, ...entries.map((entry) => entry.inboxId)) }
}
