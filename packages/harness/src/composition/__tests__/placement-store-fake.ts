import {
  EExecutionLocation,
  placementOf,
  type PlacementRecord,
  type ThreadId,
} from '@dltech/atlas-core'

import type { PlacementStore } from '../placement-controller'
import type { SupervisedAgent, ThreadSummary } from '../../store/thread-store'

export type FakePlacementStore = PlacementStore & {
  seed: (args: { threadId: ThreadId; location: EExecutionLocation; agent?: SupervisedAgent }) => void
}

export function fakePlacementStore(): FakePlacementStore {
  const records = new Map<ThreadId, PlacementRecord>()
  const agents = new Map<ThreadId, SupervisedAgent>()
  const listeners = new Set<(args: { threadId: ThreadId; record: PlacementRecord }) => void>()

  return {
    seed: ({ threadId, location, agent }) => {
      records.set(threadId, { placement: placementOf(location), revision: 0, move: null })
      if (agent !== undefined) agents.set(threadId, agent)
    },
    readPlacement: async ({ threadId }) => records.get(threadId),
    writePlacement: async ({ threadId, record }) => {
      records.set(threadId, record)
      for (const listener of [...listeners]) listener({ threadId, record })
    },
    onPlacementChanged: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    find: async ({ threadId }): Promise<ThreadSummary | undefined> => {
      const agent = agents.get(threadId)
      if (!records.has(threadId) && agent === undefined) return undefined
      return {
        id: threadId,
        head: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        workspace: null,
        repo: null,
        ...(agent === undefined ? {} : { agent }),
      }
    },
  }
}
