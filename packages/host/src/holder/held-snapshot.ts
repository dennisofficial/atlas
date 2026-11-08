import {
  NO_WORKSPACE_RECORD,
  decideHeldAction,
  workspaceStateFrom,
  type EHeldAction,
  type InboxEntry,
  type WorkspaceRecord,
} from '@dltech/atlas-core'

import { idleReleaseDue } from './held-idle'
import { countRunningShells } from './held-shells'
import { actionableEntries, isStop, readFullInbox, understandsCommand } from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'

export const readHeldAction = async (args: {
  deps: HeldSessionDeps
  draining: boolean
  turnRunning: boolean
  resumePending: boolean
  lastActivityAt: number
  runtime: SessionRuntime | undefined
  workspace: WorkspaceRecord | undefined
  preparing: boolean
}): Promise<{
  entries: InboxEntry[]
  action: EHeldAction
  inboxHead: number
  shellsRunning: boolean
}> => {
  const { deps } = args
  const entries = await readFullInbox(deps)
  const resolvable = entries.filter((entry) => understandsCommand(deps, entry))
  const workspace = workspaceStateFrom({
    record: args.workspace ?? NO_WORKSPACE_RECORD,
    preparing: args.preparing,
    pendingMessageIds: resolvable.filter((entry) => !isStop(entry)).map((entry) => entry.inboxId),
  })
  const actionable = actionableEntries({ entries: resolvable, failure: workspace.failure })
  const messagePending = actionable.some((entry) => !isStop(entry))
  const idleArgs = {
    deps,
    turnRunning: args.turnRunning,
    lastActivityAt: args.lastActivityAt,
    runtime: args.runtime,
    pendingInput: messagePending,
  }
  const quiet = idleReleaseDue({ ...idleArgs, runningShells: 0 })
  const runningShells =
    quiet && args.runtime !== undefined
      ? await countRunningShells({ deps, runtime: args.runtime })
      : 0
  const action = decideHeldAction({
    draining: args.draining,
    turn: args.turnRunning ? 'running' : 'idle',
    stopPending: actionable.some(isStop),
    messagePending: messagePending || args.resumePending,
    workspace: workspace.state,
    retryPending: workspace.retryPending,
    idleDue: quiet && runningShells === 0,
  })
  return {
    entries,
    action,
    inboxHead: Math.max(0, ...entries.map((entry) => entry.inboxId)),
    shellsRunning: runningShells > 0,
  }
}
