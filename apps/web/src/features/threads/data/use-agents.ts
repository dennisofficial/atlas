'use client'

import { useMemo } from 'react'

import { useRoster } from './use-roster'
import { fetchEvents } from './threads-api'
import { fetchSpawned } from './agents-api'
import {
  agentRecordsOf,
  agentViewsOf,
  rosterKeyOf,
  teammatesOf,
  type AgentView,
} from './agents-model'
import { eventsFromWire } from './events-from-wire'
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
}): AgentsData {
  const { threadId, channel, working } = args
  const roster = useRoster(channel)
  const refreshKey = `${rosterKeyOf({ threadId, roster })}|${working}`
  const events = useRefetched({
    key: threadId,
    refreshKey,
    enabled: true,
    load: () => fetchEvents(threadId),
  })
  const spawned = useRefetched({
    key: threadId,
    refreshKey,
    enabled: true,
    load: () => fetchSpawned(threadId),
  })

  return useMemo(() => {
    const records = agentRecordsOf(eventsFromWire(events.data ?? []))
    const views = agentViewsOf({ threadId, records, roster })
    return {
      agents: views.filter((view) => !view.teammate),
      teammates: teammatesOf({ spawned: spawned.data ?? [], views }),
      loaded: events.data !== null,
      error: events.data === null ? events.error : null,
    }
  }, [threadId, roster, events.data, events.error, spawned.data])
}
