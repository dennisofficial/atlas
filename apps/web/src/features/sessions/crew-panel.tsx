'use client'

import { Users } from 'lucide-react'

import { EAgentStatus } from '@dltech/atlas-core'
import type { CrewRow } from '@dltech/atlas-plugin-crew/client'

import { Button } from '@dltech/atlas-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'

const STATUS_LABEL: Record<EAgentStatus, string> = {
  [EAgentStatus.Running]: 'running',
  [EAgentStatus.Finished]: 'finished',
  [EAgentStatus.Failed]: 'failed',
  [EAgentStatus.Stopped]: 'stopped',
  [EAgentStatus.Blocked]: 'blocked',
  [EAgentStatus.Paused]: 'paused',
  [EAgentStatus.WaitingForModel]: 'waiting for model',
}

const effortOf = (row: CrewRow): string => {
  const turns = row.turns === 1 ? '1 turn' : `${row.turns} turns`
  const tools = row.toolCalls === 1 ? '1 tool' : `${row.toolCalls} tools`
  return `${turns} · ${tools}`
}

function CrewRowLine({ row }: { row: CrewRow }) {
  return (
    <li data-crew-row data-agent-id={row.agentId} className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{row.agentType}</span>
        <span className="min-w-0 flex-1 truncate text-xs" title={row.intent}>
          {row.intent}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[row.status]}</span>
      </span>
      {row.worktree === undefined ? null : (
        <span
          data-crew-worktree
          className="truncate font-mono text-[11px] text-muted-foreground"
          title={row.worktree.path}
        >
          {row.worktree.branch} · {row.worktree.path}
        </span>
      )}
      {row.prose === undefined ? null : (
        <span className="line-clamp-2 text-xs text-muted-foreground" title={row.prose}>
          {row.prose}
        </span>
      )}
      <span className="font-mono text-[11px] text-muted-foreground">{effortOf(row)}</span>
    </li>
  )
}

export function CrewPanel({ rows }: { rows: readonly CrewRow[] }) {
  return (
    <ul data-crew-panel className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <CrewRowLine key={row.agentId} row={row} />
      ))}
    </ul>
  )
}

export function HeaderCrew({
  roster,
  rows,
}: {
  roster: { running: number; total: number }
  rows: readonly CrewRow[]
}) {
  const shown = roster.running > 0 ? roster.running : roster.total
  const label = `${roster.total} sub-agent${roster.total === 1 ? '' : 's'}, ${roster.running} running`
  return (
    <Popover>
      <PopoverTrigger
        data-session-crew
        aria-label={label}
        title={rows.map((row) => `${row.agentType}: ${row.intent}`).join(', ')}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground tabular-nums"
          />
        }
      >
        <Users className="size-3" aria-hidden />
        <span className="font-mono">
          {roster.running > 0 && roster.total > roster.running ? `${shown}/${roster.total}` : shown}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <CrewPanel rows={rows} />
      </PopoverContent>
    </Popover>
  )
}
