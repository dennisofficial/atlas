import {
  CLOUD_WORKSPACE_PATH,
  EExecutionLocation,
  type Event,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import type { ThreadStorePort } from '../../store/thread-store'
import type { CloudBridge } from './cloud-bridge'
import { draftsOf } from './event-drafts'
import { assertTransferred } from './transfer-verification'

export type LiftAgentsPort = Pick<
  AgentRegistryPort,
  'list' | 'resume' | 'stopChildren' | 'markChildrenRelocated' | 'forgetNotices'
>

type SnapshotArgs = {
  threadId: ThreadId
  bridge: CloudBridge
  ids: IdPort
  agents: LiftAgentsPort
  localThreads: ThreadStorePort
  localLog: EventLogPort
}

/**
 * The snapshot half of the family transfer: every child gets a remote thread with its log, created
 * with the location it currently lives at. Nothing flips here — a lift that fails after this point
 * must find the family exactly where it was, and the flip is the one part that cannot be undone
 * by simply stopping.
 */
export async function transferChildLogs(args: SnapshotArgs): Promise<void> {
  const { threadId, bridge, ids, agents, localThreads, localLog } = args

  for (const child of agents.list({ threadId })) {
    const existing = await bridge.stores.threads.find({ threadId: child.agentId })
    if (existing !== undefined) continue

    const stored = await localThreads.find({ threadId: child.agentId })
    const events: readonly Event[] = await localLog.readOwn({ threadId: child.agentId })
    await bridge.stores.threads.createWithFirstEvents({
      threadId: child.agentId,
      runId: ids.nextRunId(),
      drafts: draftsOf(events),
      agent: { spawnedBy: child.spawnedBy, type: child.agentType },
      executionLocation: stored?.executionLocation ?? EExecutionLocation.Host,
      ...(stored?.workspace == null ? {} : { workspace: stored.workspace }),
      ...(stored === undefined ? {} : { repo: stored.repo }),
    })
    await assertTransferred({
      log: bridge.stores.log,
      threadId: child.agentId,
      expectedHead: events.length,
      expectedCount: events.length,
      side: 'cloud',
    })
  }
}

type FlipArgs = {
  threadId: ThreadId
  bridge: CloudBridge
  ids: IdPort
  agents: LiftAgentsPort
  localThreads: ThreadStorePort
}

/**
 * The flip half, taken only once the parent's own flip has landed: each child goes to the cloud on
 * both stores, and the notice goes to the child's new log rather than the one it just left, so its
 * own transcript says where it went.
 */
export async function flipChildrenToCloud(args: FlipArgs): Promise<void> {
  const { threadId, bridge, ids, agents, localThreads } = args
  const children = agents.list({ threadId })
  if (children.length === 0) return

  const froms = new Map<ThreadId, EExecutionLocation>()
  for (const child of children) {
    const stored = await localThreads.find({ threadId: child.agentId })
    froms.set(child.agentId, stored?.executionLocation ?? EExecutionLocation.Host)
    await bridge.stores.threads.chooseExecutionLocation({
      threadId: child.agentId,
      location: EExecutionLocation.Cloud,
    })
  }

  await agents.markChildrenRelocated({ threadId, location: EExecutionLocation.Cloud })

  for (const child of children) {
    await bridge.stores.log
      .append({
        threadId: child.agentId,
        runId: ids.nextRunId(),
        drafts: [
          {
            type: 'location-changed',
            from: froms.get(child.agentId) ?? EExecutionLocation.Host,
            to: EExecutionLocation.Cloud,
            cwd: CLOUD_WORKSPACE_PATH,
          },
        ],
      })
      .catch(() => undefined)
  }
}

export async function flipChildrenBack(args: {
  threadId: ThreadId
  bridge: CloudBridge
  agents: LiftAgentsPort
  location: EExecutionLocation
}): Promise<void> {
  const { threadId, bridge, agents, location } = args
  if (agents.list({ threadId }).length === 0) return

  await agents.markChildrenRelocated({ threadId, location }).catch(() => undefined)
  for (const child of agents.list({ threadId })) {
    await bridge.stores.threads
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
