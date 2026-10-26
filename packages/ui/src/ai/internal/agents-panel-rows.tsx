import type { ReactNode } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { cn } from '#lib/utils'
import { AgentStatusIcon, agentDisplayLabel, needsAttention } from '../agent-status'
import type { AgentsPanelAgent, AgentsPanelTeammate } from '../agents-panel-types'

const ROW_CLASS =
  'flex w-full min-w-0 items-start gap-2 rounded-md px-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50'

interface GroupHeadingProps {
  label: string
  count: number
}

export function GroupHeading({ label, count }: GroupHeadingProps) {
  return (
    <div className="flex h-7 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{count}</span>
    </div>
  )
}

export function AgentGroup({ children }: { children: ReactNode }) {
  return <section className="flex flex-col gap-0.5">{children}</section>
}

interface AgentRowProps {
  agent: AgentsPanelAgent
  running: boolean
  onSelect: (id: string) => void
}

export function AgentRow({ agent, running, onSelect }: AgentRowProps) {
  const handleClick = () => onSelect(agent.id)
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${agent.agentType} ${agent.intent}, ${agentDisplayLabel(agent.display)}`}
      className={cn(ROW_CLASS, running ? 'min-h-10 py-1.5' : 'h-8 items-center')}
    >
      <AgentStatusIcon display={agent.display} className={cn(running && 'mt-0.5')} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {agent.agentType}
          </span>
          <span className="min-w-0 truncate text-sm">{agent.intent}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {agent.elapsed}
          </span>
        </span>
        {running && agent.latestCall ? (
          <span className="truncate text-xs text-muted-foreground">{agent.latestCall}</span>
        ) : null}
      </span>
    </button>
  )
}

interface TeammateRowProps {
  teammate: AgentsPanelTeammate
  onOpen: (id: string) => void
}

export function TeammateRow({ teammate, onOpen }: TeammateRowProps) {
  const handleClick = () => onOpen(teammate.id)
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Open teammate ${teammate.title}`}
      className={cn(ROW_CLASS, 'h-8 items-center')}
    >
      <AgentStatusIcon display={teammate.display} />
      <span className="min-w-0 flex-1 truncate text-sm">{teammate.title}</span>
      <span
        className={cn(
          'shrink-0 text-xs',
          needsAttention(teammate.display) ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {agentDisplayLabel(teammate.display)}
      </span>
    </button>
  )
}

interface ShowMoreRowProps {
  label: string
  expanded: boolean
  onToggle: () => void
}

export function ShowMoreRow({ label, expanded, onToggle }: ShowMoreRowProps) {
  const Icon = expanded ? ChevronUpIcon : ChevronDownIcon
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        ROW_CLASS,
        'h-8 items-center text-xs text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
    </button>
  )
}
