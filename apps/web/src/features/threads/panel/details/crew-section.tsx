'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ESubagentReading, EContextTone } from '@dltech/atlas-client/crew'
import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'
import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { AgentsFailed, AgentsLoading } from '../agents/agents-states'
import type { AgentsData } from '../../data/use-agents'
import { useNow } from '../../data/use-now'
import { useRoster } from '../../data/use-roster'
import { useThreadPanel } from '../thread-panel-context'
import {
  crewEntriesOf,
  crewGroupsOf,
  crewMembersOf,
  crewRowsOf,
  crewTicksOf,
  type CrewGroup,
  type CrewRow,
} from './crew-model'
import { settledLabelOf } from './details-model'
import { DetailsSection } from './section'
import { useCrewVisits } from './use-crew-visits'

const TONE_CLASS: Record<EContextTone, string> = {
  [EContextTone.Normal]: 'text-muted-foreground',
  [EContextTone.Warn]: 'text-warning',
  [EContextTone.Danger]: 'text-destructive',
}

function RowDetail(props: { row: CrewRow }) {
  const { row } = props
  const { activity } = row
  const figures = row.model !== null || row.context !== null
  if (!figures && row.failure === null && activity === undefined) return undefined
  return (
    <span className="flex min-w-0 flex-col">
      {figures ? (
        <span className="flex min-w-0 justify-between gap-2">
          <span className="truncate">{row.model}</span>
          {row.context === null || row.contextTone === null ? null : (
            <span className={cn('shrink-0 tabular-nums', TONE_CLASS[row.contextTone])}>
              {row.context}
            </span>
          )}
        </span>
      ) : null}
      {row.failure === null ? null : <span className="truncate text-warning">{row.failure}</span>}
      {activity === undefined ? null : (
        <span className="flex gap-1">
          {activity.shells > 0 ? (
            <span className="rounded bg-muted px-1 text-foreground">
              {activity.shells} {activity.shells === 1 ? 'shell' : 'shells'}
            </span>
          ) : null}
          {activity.subagents > 0 ? (
            <span className="rounded bg-muted px-1 text-foreground">
              {activity.subagents} {activity.subagents === 1 ? 'agent' : 'agents'}
            </span>
          ) : null}
        </span>
      )}
    </span>
  )
}

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
          label={
            <span
              className={cn(row.reading === ESubagentReading.Settled && 'text-muted-foreground')}
            >
              {row.title}
            </span>
          }
          meta={row.state === '' ? undefined : row.state}
          detail={<RowDetail row={row} />}
          current={row.selected}
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
  const visits = useCrewVisits(agentId ?? null)
  const [expanded, setExpanded] = useState({ subagents: false, teammates: false })
  const entries = useMemo(() => crewEntriesOf({ agents, teammates }), [agents, teammates])
  const now = useNow(crewTicksOf(entries))
  const viewing = agentId ?? null
  const groups = useMemo(() => {
    const rows = crewRowsOf({ entries, roster, viewing, now })
    return crewGroupsOf({
      rows,
      members: crewMembersOf({ rows, roster, threadId, visits }),
      viewing,
      expanded,
    })
  }, [entries, roster, viewing, now, threadId, visits, expanded])

  if (!loaded) return error === null ? <AgentsLoading /> : <AgentsFailed message={error.message} />
  if (entries.length === 0 && channel === null) return null

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
