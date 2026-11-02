import type { AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'

import { AgentDrill } from './agent-drill'
import { AgentsTable } from './agents-table'
import { ContextSection } from './context-section'
import { CrewSection } from './crew-section'
import { type CrewRow } from './details-model'
import { DetailsFooter } from './footer'
import { GithubTable } from './github-table'
import { HeadSection } from './head-section'
import { ServicesTable } from './services-table'
import { SubscriptionsSection } from './subscriptions-section'
import { TodoSection } from './todo-section'

export interface DetailsTabProps {
  agents: AgentsPanelAgent[]
  teammates: CrewRow[]
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
        {drilled ? (
          <AgentDrill
            agents={props.agents}
            detailId={detailId}
            onDetailChange={props.onDetailChange}
            onJumpToSpawn={props.onJumpToSpawn}
          />
        ) : (
          <>
            <HeadSection />
            <GithubTable />
            <ServicesTable />
            <TodoSection />
            <CrewSection teammates={props.teammates} onOpenTeammate={props.onOpenTeammate} />
            <AgentsTable />
            <ContextSection current={props.contextPath} onOpen={props.onOpenContextFile} />
            <SubscriptionsSection />
          </>
        )}
      </div>
      <DetailsFooter />
    </div>
  )
}
