'use client'

import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import type { AgentsData } from '../../data/use-agents'
import { useNow } from '../../data/use-now'
import { AgentTranscript } from '../agents/agent-transcript'
import { panelAgentOf } from '../agents/agents-panel-model'
import { AgentsFailed, AgentsLoading } from '../agents/agents-states'
import { useThreadPanel } from '../thread-panel-context'
import { DetailsSection, Muted } from './section'

export function AgentDrill(props: { data: AgentsData }) {
  const { agents, loaded, error } = props.data
  const { agentId, clearAgent } = useThreadPanel()
  const now = useNow(agents.some((agent) => agent.live))
  const detail = agents.find((agent) => agent.id === agentId)
  const fallback = detail === undefined ? undefined : panelAgentOf({ view: detail, now })

  return (
    <DetailsSection title="Sub-agent">
      <Button variant="ghost" size="sm" className="self-start" onClick={clearAgent}>
        <ArrowLeftIcon />
        Back
      </Button>
      {fallback !== undefined ? (
        <AgentTranscript key={fallback.id} agentId={fallback.id} fallback={fallback} />
      ) : !loaded ? (
        error === null ? (
          <AgentsLoading />
        ) : (
          <AgentsFailed message={error.message} />
        )
      ) : (
        <Muted>Agent unavailable</Muted>
      )}
    </DetailsSection>
  )
}
