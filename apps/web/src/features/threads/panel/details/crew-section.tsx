'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'

import { AgentsFailed, AgentsLoading } from '../agents/agents-states'
import type { AgentsData } from '../../data/use-agents'
import { useRoster } from '../../data/use-roster'
import { useThreadPanel } from '../thread-panel-context'
import {
  crewGroupsOf,
  crewMembersOf,
  crewRowsOf,
  settledLabelOf,
  type CrewGroup,
  type CrewRow,
} from './details-model'
import { DetailsSection, RowButton } from './section'

function CrewRows(props: {
  title: string
  group: CrewGroup
  expanded: boolean
  onToggle: () => void
  onOpen: (row: CrewRow) => void
}) {
  const { group } = props
  if (group.total === 0) return null
  return (
    <DetailsSection title={props.title} count={`${group.working}/${group.total}`}>
      {group.rows.map((row) => (
        <RowButton key={row.id} onClick={() => props.onOpen(row)}>
          <AgentStatusIcon display={row.display} />
          <span className="min-w-0 flex-1 truncate">{row.title}</span>
          {row.subtitle === undefined ? null : (
            <span className="shrink-0 text-xs text-muted-foreground">{row.subtitle}</span>
          )}
        </RowButton>
      ))}
      {group.collapsed > 0 ? (
        <RowButton onClick={props.onToggle}>
          <span className="text-xs text-muted-foreground">
            {settledLabelOf({
              collapsed: group.collapsed,
              expanded: props.expanded,
              failed: group.collapsedFailed,
            })}
          </span>
        </RowButton>
      ) : null}
    </DetailsSection>
  )
}

export function CrewSection(props: { data: AgentsData }) {
  const { agents, teammates, loaded, error } = props.data
  const { threadId, channel, agentId, openAgent } = useThreadPanel()
  const router = useRouter()
  const roster = useRoster(channel)
  const [expanded, setExpanded] = useState({ subagents: false, teammates: false })
  const rows = useMemo(() => crewRowsOf({ agents, teammates }), [agents, teammates])
  const groups = useMemo(
    () =>
      crewGroupsOf({
        rows,
        members: crewMembersOf({
          rows,
          snapshots: roster?.agents ?? [],
          threadId,
        }),
        viewing: agentId ?? null,
        expanded,
      }),
    [rows, roster, threadId, agentId, expanded],
  )

  if (!loaded) return error === null ? <AgentsLoading /> : <AgentsFailed message={error.message} />
  if (rows.length === 0 && channel === null) return null

  const handleToggle = (key: 'subagents' | 'teammates') =>
    setExpanded((held) => ({ ...held, [key]: !held[key] }))
  const handleOpen = (row: CrewRow) => {
    if (row.teammate) router.push(`/threads/${encodeURIComponent(row.id)}`)
    else openAgent(row.id)
  }

  return (
    <>
      <CrewRows
        title="Teammates"
        group={groups.teammates}
        expanded={expanded.teammates}
        onToggle={() => handleToggle('teammates')}
        onOpen={handleOpen}
      />
      <CrewRows
        title="Sub-agents"
        group={groups.subagents}
        expanded={expanded.subagents}
        onToggle={() => handleToggle('subagents')}
        onOpen={handleOpen}
      />
    </>
  )
}
