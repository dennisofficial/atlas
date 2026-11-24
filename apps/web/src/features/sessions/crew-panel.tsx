'use client'

import { Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import type { CrewRow } from '@dltech/atlas-plugin-crew/client'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'

import { useOptionalThreadPanel } from '@/features/threads/panel/thread-panel-context'
import { messageOf } from '@/features/threads/data/use-send'

import { agentAlive, sayToAgent, stopAgent } from './data/crew-actions'
import { crewStatusLabelOf } from './data/crew-status-label'
import { sessionsApi } from './data/sessions-api'

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

function CrewMessage({ agentId, sessionId }: { agentId: string; sessionId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  const handleSend = () => {
    sayToAgent({ api: sessionsApi, sessionId, agentId, text }).catch((failure: unknown) => {
      toast.error(messageOf(failure))
    })
    setText('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-crew-message={agentId}
        render={<Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" />}
      >
        Message
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 items-center gap-1 p-1.5">
        <Input
          data-crew-message-text
          aria-label={`Message ${agentId}`}
          className="h-7 text-xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSend()
          }}
        />
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          data-crew-message-send
          onClick={handleSend}
        >
          Send
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function CrewRowActions({ row, sessionId }: { row: CrewRow; sessionId: string }) {
  const handleStop = () => {
    stopAgent({ api: sessionsApi, sessionId, agentId: row.agentId }).catch((failure: unknown) => {
      toast.error(messageOf(failure))
    })
  }

  return (
    <span data-crew-actions className="flex items-center gap-0.5">
      <CrewMessage agentId={row.agentId} sessionId={sessionId} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs"
        data-crew-stop={row.agentId}
        onClick={handleStop}
      >
        Stop
      </Button>
    </span>
  )
}

function CrewRowLine({
  row,
  onOpenAgent,
  sessionId,
}: {
  row: CrewRow
  onOpenAgent: ((agentId: string) => void) | null
  sessionId: string | undefined
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
      {sessionId !== undefined && agentAlive(row.status) ? (
        <CrewRowActions row={row} sessionId={sessionId} />
      ) : null}
    </li>
  )
}

export function CrewPanel({
  rows,
  sessionId,
  onOpenAgent,
}: {
  rows: readonly CrewRow[]
  sessionId?: string | undefined
  onOpenAgent?: ((agentId: string) => void) | null
}) {
  const panel = useOptionalThreadPanel()
  const openAgent = onOpenAgent === undefined ? (panel?.openAgent ?? null) : onOpenAgent
  return (
    <ul data-crew-panel className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <CrewRowLine key={row.agentId} row={row} onOpenAgent={openAgent} sessionId={sessionId} />
      ))}
    </ul>
  )
}

export function HeaderCrew({
  roster,
  rows,
  sessionId,
}: {
  roster: { running: number; total: number }
  rows: readonly CrewRow[]
  sessionId?: string | undefined
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
        <CrewPanel rows={rows} sessionId={sessionId} onOpenAgent={handleOpenAgent} />
      </PopoverContent>
    </Popover>
  )
}
