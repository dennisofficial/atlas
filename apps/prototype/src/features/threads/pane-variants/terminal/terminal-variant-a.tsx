import { CheckIcon, PlusIcon, XIcon } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { DisconnectedBody, EmptyBody, EndedBody, LiveShell } from './terminal-bodies'
import {
  ETerminalScenario,
  ETerminalStatus,
  MAX_PANE_TERMINALS,
  type PaneTerminal,
  useTerminalScenario,
} from './terminal-scenario'
import { ScenarioSwitch } from './terminal-scenario-switch'

const STATUS_CLASS: Record<ETerminalStatus, string> = {
  [ETerminalStatus.Live]: 'bg-success',
  [ETerminalStatus.Ended]: 'bg-muted-foreground/40',
  [ETerminalStatus.Disconnected]: 'bg-destructive',
}

function tabTitle(terminal: PaneTerminal): string {
  if (terminal.status === ETerminalStatus.Ended) return `${terminal.label} · ended`
  if (terminal.status === ETerminalStatus.Disconnected) return `${terminal.label} · gone`
  return terminal.label
}

interface StripTabProps {
  terminal: PaneTerminal
  active: boolean
  editing: boolean
  onSelect: () => void
  onEdit: () => void
  onCommit: (label: string) => void
  onClose: () => void
}

interface RenameFieldProps {
  initial: string
  onCommit: (label: string) => void
  onCancel: () => void
}

function RenameField({ initial, onCommit, onCancel }: RenameFieldProps) {
  const [draft, setDraft] = useState(initial)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') onCommit(draft)
    if (event.key === 'Escape') onCancel()
  }

  return (
    <div className="flex items-center gap-1 pl-2">
      <input
        ref={input}
        value={draft}
        aria-label="Terminal name"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={handleKeyDown}
        className="h-5 w-24 rounded border border-ring bg-background px-1 font-mono text-[11px] outline-none"
      />
      <button
        type="button"
        aria-label="Save terminal name"
        onClick={() => onCommit(draft)}
        className="text-muted-foreground hover:text-foreground"
      >
        <CheckIcon className="size-3" />
      </button>
    </div>
  )
}

function StripTab({
  terminal,
  active,
  editing,
  onSelect,
  onEdit,
  onCommit,
  onClose,
}: StripTabProps) {
  return (
    <div
      className={cn(
        'group/tab flex h-9 max-w-44 shrink-0 items-center border-b-2 transition-colors',
        active ? 'border-primary bg-muted/40' : 'border-transparent hover:bg-muted/20',
      )}
    >
      {editing ? (
        <RenameField
          initial={terminal.label}
          onCommit={onCommit}
          onCancel={() => onCommit(terminal.label)}
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={onEdit}
          title="Double-click to rename"
          className={cn(
            'flex h-full min-w-0 items-center gap-1.5 pl-2 text-xs',
            active ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_CLASS[terminal.status])} />
          <span className="truncate">{tabTitle(terminal)}</span>
        </button>
      )}
      <button
        type="button"
        aria-label={`Close ${terminal.label}`}
        onClick={onClose}
        className={cn(
          'mx-1 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
          active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

export function TerminalVariantA() {
  const {
    scenario,
    terminals,
    activeId,
    active,
    setScenario,
    select,
    create,
    rename,
    close,
    wake,
  } = useTerminalScenario()
  const [editingId, setEditingId] = useState<string>()
  const asleep = scenario === ETerminalScenario.Asleep
  const live = terminals.filter((terminal) => terminal.status === ETerminalStatus.Live).length

  const handleCommit = (terminal: PaneTerminal, label: string) => {
    rename(terminal.id, label)
    setEditingId(undefined)
  }

  const renderBody = () => {
    if (asleep) return <DisconnectedBody onWake={wake} />
    if (!active) return <EmptyBody onCreate={create} />
    if (active.status === ETerminalStatus.Ended) {
      return <EndedBody terminal={active} onClose={() => close(active.id)} />
    }
    return <LiveShell key={active.id} terminal={active} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="flex items-center gap-1.5 text-xs">
          <span className={cn('size-1.5 rounded-full', asleep ? 'bg-destructive' : 'bg-success')} />
          <span className="font-medium text-foreground">{asleep ? 'pod asleep' : 'pod'}</span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground">dennis · 4 vCPU · 8 GB</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
          {live}/{MAX_PANE_TERMINALS}
        </span>
      </header>
      <div className="flex h-9 shrink-0 items-stretch border-b border-border">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {terminals.map((terminal) => (
            <StripTab
              key={terminal.id}
              terminal={terminal}
              active={terminal.id === activeId}
              editing={editingId === terminal.id}
              onSelect={() => select(terminal.id)}
              onEdit={() => setEditingId(terminal.id)}
              onCommit={(label) => handleCommit(terminal, label)}
              onClose={() => close(terminal.id)}
            />
          ))}
          {terminals.length === 0 ? (
            <span className="flex items-center px-2 text-[11px] text-muted-foreground">
              no terminals
            </span>
          ) : null}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          title="New terminal"
          aria-label="New terminal"
          disabled={asleep || live >= MAX_PANE_TERMINALS}
          onClick={create}
          className="my-auto mr-1.5 shrink-0"
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{renderBody()}</div>
      <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border px-2">
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {active?.cwd ?? '~'}
        </span>
        <span className="truncate text-[10px] text-muted-foreground/70">
          {active?.lastCommand ? `$ ${active.lastCommand}` : ''}
        </span>
        <ScenarioSwitch scenario={scenario} onChange={setScenario} className="ml-auto" />
      </footer>
    </div>
  )
}
