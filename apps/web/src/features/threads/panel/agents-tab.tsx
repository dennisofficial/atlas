'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'

import { AgentsPanel, type AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'

import type { AgentsData } from '../data/use-agents'
import { useNow } from '../data/use-now'
import { AgentTranscript } from './agents/agent-transcript'
import { agentsOfflineCopyOf } from './agents/agents-offline-copy'
import { panelAgentOf } from './agents/agents-panel-model'
import { documentLookup, jumpToSpawn } from './agents/agents-spawn-jump'
import { AgentsFailed, AgentsLoading, AgentsOffline } from './agents/agents-states'
import { useThreadPanel } from './thread-panel-context'

export function AgentsTab(props: { data: AgentsData }) {
  const { agents, teammates, loaded, error } = props.data
  const { agentId, openAgent, clearAgent, closePanel, channel, pod } = useThreadPanel()
  const router = useRouter()
  const now = useNow(agents.some((agent) => agent.live))
  const panelAgents = useMemo(
    () => agents.map((view) => panelAgentOf({ view, now })),
    [agents, now],
  )
  const renderTranscript = (agent: AgentsPanelAgent) => (
    <AgentTranscript key={agent.id} agentId={agent.id} fallback={agent} />
  )

  const handleDetailChange = (id: string | undefined) => {
    if (id === undefined) clearAgent()
    else openAgent(id)
  }
  const handleOpenTeammate = (id: string) => router.push(`/threads/${encodeURIComponent(id)}`)
  const handleJumpToSpawn = (id: string) => {
    closePanel()
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
      renderTranscript={renderTranscript}
    />
  )
}
