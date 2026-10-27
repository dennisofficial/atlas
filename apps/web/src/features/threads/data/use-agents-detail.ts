'use client'

import { useMemo } from 'react'

import type { ToolProps } from '@dltech/atlas-ui/ai/tool'

import { briefOfEvents, callsOfEvents } from './agents-calls'
import { useRefetched } from './agents-refetch'
import { fetchEvents } from './threads-api'

export type AgentDetail = { brief: string; calls: ToolProps[] }

const NO_BRIEF = ''

export function useAgentDetail(args: {
  agentId: string | undefined
  refreshKey: string
}): AgentDetail | null {
  const { agentId, refreshKey } = args
  const events = useRefetched({
    key: agentId ?? NO_BRIEF,
    refreshKey,
    enabled: agentId !== undefined,
    load: () => fetchEvents(agentId ?? NO_BRIEF),
  })

  return useMemo(() => {
    if (events.data === null) return null
    return {
      brief: briefOfEvents(events.data) ?? NO_BRIEF,
      calls: callsOfEvents(events.data),
    }
  }, [events.data])
}
