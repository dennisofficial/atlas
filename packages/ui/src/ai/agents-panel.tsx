'use client'

import { useState } from 'react'
import { BotIcon } from 'lucide-react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '#components/empty'
import {
  doneAgents,
  hiddenDoneCount,
  runningAgentCount,
  runningAgents,
  showMoreLabel,
  visibleDone,
} from './agents-panel-groups'
import type { AgentsPanelAgent, AgentsPanelTeammate } from './agents-panel-types'
import { AgentsPanelDetail } from './internal/agents-panel-detail'
import {
  AgentGroup,
  AgentRow,
  GroupHeading,
  ShowMoreRow,
  TeammateRow,
} from './internal/agents-panel-rows'

export { runningAgentCount }
export type { AgentContext, AgentsPanelAgent, AgentsPanelTeammate } from './agents-panel-types'

export interface AgentsPanelProps {
  agents: AgentsPanelAgent[]
  teammates: AgentsPanelTeammate[]
  detailId?: string
  onDetailChange: (id: string | undefined) => void
  onOpenTeammate: (id: string) => void
  onJumpToSpawn: (id: string) => void
}

function EmptyAgents() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>No agents yet</EmptyTitle>
        <EmptyDescription>
          Sub-agents and teammates started in this thread show up here
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function AgentsPanel({
  agents,
  teammates,
  detailId,
  onDetailChange,
  onOpenTeammate,
  onJumpToSpawn,
}: AgentsPanelProps) {
  const [doneExpanded, setDoneExpanded] = useState(false)
  const detail = agents.find((agent) => agent.id === detailId)
  const running = runningAgents(agents)
  const done = doneAgents(agents)
  const hidden = hiddenDoneCount(done)

  const handleBack = () => onDetailChange(undefined)
  const handleToggleDone = () => setDoneExpanded((previous) => !previous)

  if (detail) {
    return (
      <AgentsPanelDetail
        key={detail.id}
        agent={detail}
        onBack={handleBack}
        onJumpToSpawn={onJumpToSpawn}
      />
    )
  }
  if (agents.length === 0 && teammates.length === 0) return <EmptyAgents />

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2">
      {running.length > 0 ? (
        <AgentGroup>
          <GroupHeading label="Running" count={running.length} />
          {running.map((agent) => (
            <AgentRow key={agent.id} agent={agent} running onSelect={onDetailChange} />
          ))}
        </AgentGroup>
      ) : null}
      {teammates.length > 0 ? (
        <AgentGroup>
          <GroupHeading label="Teammates" count={teammates.length} />
          {teammates.map((teammate) => (
            <TeammateRow key={teammate.id} teammate={teammate} onOpen={onOpenTeammate} />
          ))}
        </AgentGroup>
      ) : null}
      {done.length > 0 ? (
        <AgentGroup>
          <GroupHeading label="Done" count={done.length} />
          {visibleDone({ done, expanded: doneExpanded }).map((agent) => (
            <AgentRow key={agent.id} agent={agent} running={false} onSelect={onDetailChange} />
          ))}
          {hidden > 0 ? (
            <ShowMoreRow
              label={doneExpanded ? 'Show fewer' : showMoreLabel(hidden)}
              expanded={doneExpanded}
              onToggle={handleToggleDone}
            />
          ) : null}
        </AgentGroup>
      ) : null}
    </div>
  )
}
