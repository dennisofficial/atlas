import type { AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'

import { AgentDrill } from './agent-drill'
import { ContextSection } from './context-section'
import { CrewSection } from './crew-section'
import { type CrewRow } from './details-model'
import { DetailsFooter } from './footer'
import { GithubSection } from './github-section'
import { GrantsSection } from './grants-section'
import { HeadSection } from './head-section'
import { PodSection } from './pod-section'
import { ProcessesSection } from './processes-section'
import { SubscriptionsSection } from './subscriptions-section'
import { TodoSection } from './todo-section'

export interface DetailsTabProps {
  title: string
  agents: AgentsPanelAgent[]
  teammates: CrewRow[]
  subagents: CrewRow[]
  detailId?: string
  onDetailChange: (id: string | undefined) => void
  onOpenTeammate: (id: string) => void
  onJumpToSpawn: (id: string) => void
  contextPath?: string
  onOpenContextFile: (path: string) => void
}

export function DetailsTab(props: DetailsTabProps) {
  const { detailId } = props
  const drilled = detailId !== undefined && props.agents.some((agent) => agent.id === detailId)

  const handleOpenAgent = (id: string) => {
    if (props.agents.some((agent) => agent.id === id)) props.onDetailChange(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
        {drilled ? (
          <AgentDrill
            agents={props.agents}
            detailId={detailId}
            onDetailChange={props.onDetailChange}
            onJumpToSpawn={props.onJumpToSpawn}
          />
        ) : (
          <>
            <HeadSection title={props.title} />
            <PodSection />
            <GithubSection />
            <ContextSection current={props.contextPath} onOpen={props.onOpenContextFile} />
            <ProcessesSection />
            <GrantsSection />
            <TodoSection />
            <CrewSection
              teammates={props.teammates}
              subagents={props.subagents}
              onOpenTeammate={props.onOpenTeammate}
              onOpenAgent={handleOpenAgent}
            />
            <SubscriptionsSection />
          </>
        )}
      </div>
      <DetailsFooter />
    </div>
  )
}
