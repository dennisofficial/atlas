'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ESubagentReading, EContextTone } from '@dltech/atlas-client/crew'
import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dltech/atlas-ui/components/table'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CrewLoading } from '../agents/agents-skeletons'
import { AgentsFailed } from '../agents/agents-states'
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
import { BODY_CELL, HEAD_CELL, MID_COLUMN, Mono, ToggleRow } from './table-parts'
import { useCrewVisits } from './use-crew-visits'

const TONE_CLASS: Record<EContextTone, string> = {
  [EContextTone.Normal]: 'text-muted-foreground',
  [EContextTone.Warn]: 'text-warning',
  [EContextTone.Danger]: 'text-destructive',
}

function RowNotes({ row }: { row: CrewRow }) {
  const { activity } = row
  if (row.failure === null && activity === undefined) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
      {row.failure === null ? null : <span className="truncate text-warning">{row.failure}</span>}
      {activity === undefined || activity.shells === 0 ? null : (
        <span className="rounded bg-muted px-1 text-foreground">
          {activity.shells} {activity.shells === 1 ? 'shell' : 'shells'}
        </span>
      )}
      {activity === undefined || activity.subagents === 0 ? null : (
        <span className="rounded bg-muted px-1 text-foreground">
          {activity.subagents} {activity.subagents === 1 ? 'agent' : 'agents'}
        </span>
      )}
    </span>
  )
}

function CrewTableRow(props: { row: CrewRow; onOpen: (row: CrewRow) => void }) {
  const { row } = props
  const narrowLine = [row.model, row.state].filter((part) => part !== null && part !== '')
  return (
    <TableRow aria-current={row.selected ? 'true' : undefined}>
      <TableCell className={`${BODY_CELL} w-6`}>
        <span className="flex size-4 items-center justify-center text-muted-foreground">
          <AgentStatusIcon display={row.display} />
        </span>
      </TableCell>
      <TableCell className={`${BODY_CELL} w-full max-w-0`}>
        <button
          type="button"
          aria-current={row.selected ? 'true' : undefined}
          onClick={() => props.onOpen(row)}
          className="block w-full min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span
            className={cn(
              'block truncate text-sm',
              row.reading === ESubagentReading.Settled && 'text-muted-foreground',
            )}
            title={row.title}
          >
            {row.title}
          </span>
          {narrowLine.length === 0 ? null : (
            <span className="block truncate text-xs text-muted-foreground tabular-nums @[480px]:hidden">
              {narrowLine.join(' · ')}
            </span>
          )}
        </button>
        <RowNotes row={row} />
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-xs text-muted-foreground`}>
        {row.model}
      </TableCell>
      <TableCell className={`${BODY_CELL} ${MID_COLUMN} text-right`}>
        <Mono>{row.state}</Mono>
      </TableCell>
      <TableCell className={`${BODY_CELL} text-right`}>
        {row.context === null || row.contextTone === null ? null : (
          <span className={cn('font-mono text-xs tabular-nums', TONE_CLASS[row.contextTone])}>
            {row.context}
          </span>
        )}
      </TableCell>
    </TableRow>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD_CELL}>
              <span className="sr-only">Status</span>
            </TableHead>
            <TableHead className={HEAD_CELL}>Title</TableHead>
            <TableHead className={`${HEAD_CELL} ${MID_COLUMN}`}>Model</TableHead>
            <TableHead className={`${HEAD_CELL} ${MID_COLUMN} text-right`}>State</TableHead>
            <TableHead className={`${HEAD_CELL} text-right`}>Context</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.rows.map((row) => (
            <CrewTableRow key={row.id} row={row} onOpen={props.onOpen} />
          ))}
          {group.collapsed > 0 ? (
            <ToggleRow
              colSpan={5}
              onToggle={props.onToggle}
              label={settledLabelOf({
                collapsed: group.collapsed,
                expanded: props.expanded,
                failed: group.collapsedFailed,
              })}
            />
          ) : null}
        </TableBody>
      </Table>
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

  if (!loaded) return error === null ? <CrewLoading /> : <AgentsFailed message={error.message} />
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
