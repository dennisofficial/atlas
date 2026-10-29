'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'
import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

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
import { DetailsSection } from './section'

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
        <DetailRow
          key={row.id}
          icon={<AgentStatusIcon display={row.display} />}
          label={row.title}
          meta={row.subtitle}
          onClick={() => props.onOpen(row)}
        />
      ))}
      {group.collapsed > 0 ? (
        <DetailRow
          onClick={props.onToggle}
          label={
            <span className="text-xs text-muted-foreground">
              {settledLabelOf({
                collapsed: group.collapsed,
                expanded: props.expanded,
                failed: group.collapsedFailed,
              })}
            </span>
          }
        />
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
