'use client'

import { useMemo } from 'react'

import type { Event } from '@dltech/atlas-core'

import { useRoster } from './use-roster'
import { useThreadBackend } from './use-thread-backend'
import {
  agentRecordsOf,
  agentViewsOf,
  rosterKeyOf,
  teammatesOf,
  type AgentView,
} from './agents-model'
import { useRefetched } from './agents-refetch'
import type { ServeChannel } from './live-thread-view'
import type { AgentsPanelTeammate } from '@dltech/atlas-ui/ai/agents-panel'

export type AgentsData = {
  agents: AgentView[]
  teammates: AgentsPanelTeammate[]
  loaded: boolean
  error: Error | null
}

export function useAgents(args: {
  threadId: string
  channel: ServeChannel | null
  working: boolean
  events: readonly Event[]
  loaded: boolean
  error: Error | null
}): AgentsData {
  const { threadId, channel, working, events, loaded, error } = args
  const { fetchSpawned } = useThreadBackend()
  const roster = useRoster(channel)
  const refreshKey = `${rosterKeyOf({ threadId, roster })}|${working}`
  const spawned = useRefetched({
    key: threadId,
    refreshKey,
    enabled: true,
    load: () => fetchSpawned(threadId),
  })

  return useMemo(() => {
    const records = agentRecordsOf(events)
    const views = agentViewsOf({ threadId, records, roster })
    return {
      agents: views.filter((view) => !view.teammate),
      teammates: teammatesOf({ spawned: spawned.data ?? [], views }),
      loaded,
      error: loaded ? null : error,
    }
  }, [threadId, roster, events, loaded, error, spawned.data])
}
