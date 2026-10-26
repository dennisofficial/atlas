'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'

import { AgentsPanel } from '@dltech/atlas-ui/ai/agents-panel'

import type { AgentsData } from '../data/use-agents'
import { useAgentDetail } from '../data/use-agents-detail'
import { useNow } from '../data/use-now'
import { agentsOfflineCopyOf } from './agents/agents-offline-copy'
import { panelAgentOf } from './agents/agents-panel-model'
import { documentLookup, jumpToSpawn } from './agents/agents-spawn-jump'
import { AgentsFailed, AgentsLoading, AgentsOffline } from './agents/agents-states'
import { useThreadPanel } from './thread-panel-context'

export function AgentsTab(props: { data: AgentsData }) {
  const { agents, teammates, loaded, error } = props.data
  const { agentId, openAgent, clearAgent, channel, pod } = useThreadPanel()
  const router = useRouter()
  const now = useNow(agents.some((agent) => agent.live))
  const selected = agents.find((agent) => agent.id === agentId)
  const detail = useAgentDetail({
    agentId: selected?.id,
    refreshKey: `${selected?.display}:${selected?.toolCalls}`,
  })
  const panelAgents = useMemo(
    () =>
      agents.map((view) =>
        panelAgentOf({ view, detail: view.id === selected?.id ? detail : null, now }),
      ),
    [agents, selected?.id, detail, now],
  )

  const handleDetailChange = (id: string | undefined) => {
    if (id === undefined) clearAgent()
    else openAgent(id)
  }
  const handleOpenTeammate = (id: string) => router.push(`/threads/${encodeURIComponent(id)}`)
  const handleJumpToSpawn = (id: string) => {
    jumpToSpawn({ agentId: id, lookup: documentLookup })
  }

  if (!loaded) return error === null ? <AgentsLoading /> : <AgentsFailed message={error.message} />
  const offline = agentsOfflineCopyOf(pod)
  if (agents.length === 0 && teammates.length === 0 && channel === null && offline !== null) {
    return <AgentsOffline title={offline.title} description={offline.description} />
  }

  return (
    <AgentsPanel
      agents={panelAgents}
      teammates={teammates}
      detailId={agentId}
      onDetailChange={handleDetailChange}
      onOpenTeammate={handleOpenTeammate}
      onJumpToSpawn={handleJumpToSpawn}
    />
  )
}
