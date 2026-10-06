import {
  CLOUD_WORKSPACE_PATH,
  EExecutionLocation,
  projectDirectoryOf,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import { logFieldsOf } from '../../store/logs'
import type { ThreadStorePort } from '../../store/thread-store'
import type { RestoredWorkspace } from '../../workspace/transfer/manifest'
import { restoredDirectoryOf } from './workspace-arrival'

export type LiftAgentsPort = Pick<
  AgentRegistryPort,
  'list' | 'resume' | 'stopChildren' | 'markChildrenRelocated' | 'forgetNotices' | 'pauseChildren'
>

type FlipArgs = {
  threadId: ThreadId
  ids: IdPort
  agents: LiftAgentsPort
  localThreads: ThreadStorePort
  localLog: EventLogPort
  logPort?: LogPort | undefined
  restoredWorkspace?: RestoredWorkspace | undefined
}

const cloudDirectoryOf = async ({
  threadId,
  localThreads,
  localLog,
  restored,
}: {
  threadId: ThreadId
  localThreads: ThreadStorePort
  localLog: EventLogPort
  restored: RestoredWorkspace | undefined
}): Promise<string> => {
  if (restored === undefined) return CLOUD_WORKSPACE_PATH
  const stored = await localThreads.find({ threadId })
  const events = await localLog.readOwn({ threadId })
  const source = projectDirectoryOf({ events, launchDirectory: stored?.workspace ?? restored.cwd })
  return restoredDirectoryOf({ source, restored }).path
}

/**
 * The flip half of the family move, taken once the parent's own flip has landed: each child's local
 * row goes to the cloud, and the notice goes to its local log so its transcript says where it went.
 * The logs themselves never move here — the whole family lives in the parent's session directory,
 * which the lift's archive carries in one piece.
 */
export async function flipChildrenToCloud(args: FlipArgs): Promise<void> {
  const { threadId, ids, agents, localThreads, localLog } = args
  const children = agents.list({ threadId })
  if (children.length === 0) return

  const froms = new Map<ThreadId, EExecutionLocation>()
  for (const child of children) {
    const stored = await localThreads.find({ threadId: child.agentId })
    froms.set(child.agentId, stored?.executionLocation ?? EExecutionLocation.Host)
    await localThreads.chooseExecutionLocation({
      threadId: child.agentId,
      location: EExecutionLocation.Cloud,
    })
  }

  await agents.markChildrenRelocated({ threadId, location: EExecutionLocation.Cloud })

  for (const child of children) {
    const cwd = await cloudDirectoryOf({
      threadId: child.agentId,
      localThreads,
      localLog,
      restored: args.restoredWorkspace,
    })
    await localLog
      .append({
        threadId: child.agentId,
        runId: ids.nextRunId(),
        drafts: [
          {
            type: 'location-changed',
            from: froms.get(child.agentId) ?? EExecutionLocation.Host,
            to: EExecutionLocation.Cloud,
            cwd,
          },
        ],
      })
      .catch((error: unknown) => {
        args.logPort?.warn({
          source: 'cloud.lift',
          message: "a child's location-changed notice never reached its local log",
          threadId: args.threadId,
          data: { childId: child.agentId, operation: 'append-child-location-changed' },
          ...logFieldsOf({ error }),
        })
      })
  }
}

export async function flipChildrenBack(args: {
  threadId: ThreadId
  localThreads: ThreadStorePort
  agents: LiftAgentsPort
  location: EExecutionLocation
}): Promise<void> {
  const { threadId, localThreads, agents, location } = args
  if (agents.list({ threadId }).length === 0) return

  await agents.markChildrenRelocated({ threadId, location }).catch(() => undefined)
  for (const child of agents.list({ threadId })) {
    await localThreads
      .chooseExecutionLocation({ threadId: child.agentId, location })
      .catch(() => undefined)
  }
}

/**
 * A failed lift leaves the family working: children it stopped get resumed where they were, since
 * the sandbox that would have adopted them is never coming.
 */
export async function resumeStoppedChildren(args: {
  agents: LiftAgentsPort
  threadId: ThreadId
  stopped: readonly ThreadId[]
}): Promise<void> {
  for (const agentId of args.stopped) {
    await args.agents.resume({ agentId, threadId: args.threadId }).catch(() => undefined)
  }
}
