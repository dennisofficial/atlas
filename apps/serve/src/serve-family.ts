import { EAgentStatus, type ThreadId } from '@dltech/atlas-core'
import {
  holdFamilyIntake,
  type AgentRegistryPort,
  type MessageIntake,
  type ThreadStorePort,
} from '@dltech/atlas-harness'

import type { ServeFamily } from './serve-app'
import { familyThreadIdsOf } from './workspace-hooks'

export function serveFamilyOf(args: {
  agents: AgentRegistryPort
  threads: ThreadStorePort
  intake: MessageIntake | undefined
}): ServeFamily {
  const { agents, threads, intake } = args
  const pausedChildren = new Set<ThreadId>()
  let releaseFamily: (() => void) | undefined

  const hold = async (threadId: ThreadId): Promise<void> => {
    releaseFamily ??= await holdFamilyIntake({ threadId, threads, intake })
  }

  return {
    freeze: ({ threadId }) => hold(threadId),
    pauseChildren: async ({ threadId }) => {
      await hold(threadId)
      try {
        for (const child of await agents.pauseChildren({ threadId })) pausedChildren.add(child)
      } finally {
        const family = await familyThreadIdsOf({ root: threadId, threads })
        for (const child of agents.listEverywhere()) {
          if (family.has(child.spawnedBy) && child.status === EAgentStatus.Paused)
            pausedChildren.add(child.agentId)
        }
      }
    },
    resumeChildren: async () => {
      const roster = agents.listEverywhere()
      for (const agentId of pausedChildren) {
        const child = roster.find((entry) => entry.agentId === agentId)
        if (child === undefined)
          throw new Error(`paused child ${agentId} is missing from the family roster`)
        if (child.status === EAgentStatus.Paused) {
          const resumed = await agents.resume({ agentId, threadId: child.spawnedBy })
          if (!resumed.ok) throw new Error(resumed.reason)
        }
        pausedChildren.delete(agentId)
      }
      releaseFamily?.()
      releaseFamily = undefined
    },
  }
}
