'use client'

import { Users } from 'lucide-react'
import { useState } from 'react'

import type { CrewRow } from '@dltech/atlas-plugin-crew/client'

import { Button } from '@dltech/atlas-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'

import { useOptionalThreadPanel } from '@/features/threads/panel/thread-panel-context'

import { crewStatusLabelOf } from './data/crew-status-label'

const effortOf = (row: CrewRow): string => {
  const turns = row.turns === 1 ? '1 turn' : `${row.turns} turns`
  const tools = row.toolCalls === 1 ? '1 tool' : `${row.toolCalls} tools`
  return `${turns} · ${tools}`
}

function CrewRowBody({ row }: { row: CrewRow }) {
  return (
    <>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{row.agentType}</span>
        <span className="min-w-0 flex-1 truncate text-xs" title={row.intent}>
          {row.intent}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {crewStatusLabelOf(row.status)}
        </span>
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
    </>
  )
}

function CrewRowLine({
  row,
  onOpenAgent,
}: {
  row: CrewRow
  onOpenAgent: ((agentId: string) => void) | null
}) {
  const handleOpen = () => onOpenAgent?.(row.agentId)
  return (
    <li data-crew-row data-agent-id={row.agentId} className="flex min-w-0 flex-col gap-0.5">
      {onOpenAgent === null ? (
        <CrewRowBody row={row} />
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="flex min-w-0 flex-col gap-0.5 rounded-sm text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <CrewRowBody row={row} />
        </button>
      )}
    </li>
  )
}

export function CrewPanel({
  rows,
  onOpenAgent,
}: {
  rows: readonly CrewRow[]
  onOpenAgent?: ((agentId: string) => void) | null
}) {
  const panel = useOptionalThreadPanel()
  const openAgent = onOpenAgent === undefined ? (panel?.openAgent ?? null) : onOpenAgent
  return (
    <ul data-crew-panel className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <CrewRowLine key={row.agentId} row={row} onOpenAgent={openAgent} />
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
  const [open, setOpen] = useState(false)
  const panel = useOptionalThreadPanel()
  const shown = roster.running > 0 ? roster.running : roster.total
  const label = `${roster.total} sub-agent${roster.total === 1 ? '' : 's'}, ${roster.running} running`
  const handleOpenAgent = (agentId: string) => {
    setOpen(false)
    panel?.openAgent(agentId)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        <CrewPanel rows={rows} onOpenAgent={handleOpenAgent} />
      </PopoverContent>
    </Popover>
  )
}
