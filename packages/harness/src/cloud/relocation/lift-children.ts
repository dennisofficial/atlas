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
import { storedFamilyIds } from './family-arrival'

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
  const member = restored.family?.threads.find((entry) => entry.threadId === threadId)
  if (member !== undefined) return member.active?.path ?? member.home
  if (restored.family !== undefined) throw new Error(`the restored family has no workspace mapping for ${threadId}`)
  const stored = await localThreads.find({ threadId })
  const events = await localLog.readOwn({ threadId })
  const source = projectDirectoryOf({ events, launchDirectory: stored?.workspace ?? restored.cwd })
  return restoredDirectoryOf({ source, restored }).path
}

export async function flipChildrenToCloud(args: FlipArgs): Promise<void> {
  const { threadId, ids, agents, localThreads, localLog } = args
  const owners = await storedFamilyIds({ threadId, threads: localThreads })
  const children = args.restoredWorkspace?.family === undefined
    ? [...new Set([...owners.slice(1), ...agents.list({ threadId }).map((child) => child.agentId)])]
    : owners.slice(1)
  if (children.length === 0) return

  const froms = new Map<ThreadId, EExecutionLocation>()
  for (const child of children) {
    const stored = await localThreads.find({ threadId: child })
    froms.set(child, stored?.executionLocation ?? EExecutionLocation.Host)
    await localThreads.chooseExecutionLocation({
      threadId: child,
      location: EExecutionLocation.Cloud,
    })
  }

  for (const owner of owners) {
    if (owner !== threadId && (await localThreads.spawned({ threadId: owner })).length === 0) continue
    await agents.markChildrenRelocated({ threadId: owner, location: EExecutionLocation.Cloud })
  }

  for (const child of children) {
    const cwd = await cloudDirectoryOf({
      threadId: child,
      localThreads,
      localLog,
      restored: args.restoredWorkspace,
    })
    await localLog
      .append({
        threadId: child,
        runId: ids.nextRunId(),
        drafts: [
          {
            type: 'location-changed',
            from: froms.get(child) ?? EExecutionLocation.Host,
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
          data: { childId: child, operation: 'append-child-location-changed' },
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
  const owners = await storedFamilyIds({ threadId, threads: localThreads })
  const children = new Set(owners.filter((id) => id !== threadId))
  for (const owner of owners) {
    for (const child of agents.list({ threadId: owner })) children.add(child.agentId)
    if (owner === threadId || (await localThreads.spawned({ threadId: owner })).length > 0) await agents.markChildrenRelocated({ threadId: owner, location })
  }
  for (const child of children) await localThreads.chooseExecutionLocation({ threadId: child, location })
}

export async function resumeStoppedChildren(args: {
  agents: LiftAgentsPort
  threadId: ThreadId
  stopped: readonly ThreadId[]
}): Promise<void> {
  for (const agentId of args.stopped) {
    await args.agents.resume({ agentId, threadId: args.threadId }).catch(() => undefined)
  }
}
