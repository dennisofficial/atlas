import { PlusIcon, XIcon } from 'lucide-react'

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

const STATUS_LABEL: Record<ETerminalStatus, string> = {
  [ETerminalStatus.Live]: 'live',
  [ETerminalStatus.Ended]: 'ended',
  [ETerminalStatus.Disconnected]: 'disconnected',
}

function rowStatus(terminal: PaneTerminal): string {
  if (terminal.status === ETerminalStatus.Ended && terminal.exitCode !== null) {
    return `ended · exit ${terminal.exitCode}`
  }
  return STATUS_LABEL[terminal.status]
}

function rowNote(terminal: PaneTerminal): string {
  if (terminal.status === ETerminalStatus.Live) {
    return terminal.lastCommand ? `$ ${terminal.lastCommand}` : '$'
  }
  return rowStatus(terminal)
}

interface RailRowProps {
  terminal: PaneTerminal
  active: boolean
  onSelect: () => void
  onClose: () => void
}

function RailRow({ terminal, active, onSelect, onClose }: RailRowProps) {
  return (
    <div
      className={cn(
        'group/row relative rounded-md border',
        active ? 'border-border bg-muted/60' : 'border-transparent hover:bg-muted/30',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full min-w-0 flex-col gap-0.5 px-2 py-1.5 pr-6 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_CLASS[terminal.status])} />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              active ? 'font-medium text-foreground' : 'text-foreground/80',
            )}
          >
            {terminal.label}
          </span>
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">{terminal.cwd}</span>
        <span className="truncate font-mono text-[10px] text-muted-foreground/70">
          {rowNote(terminal)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${terminal.label}`}
        onClick={onClose}
        className={cn(
          'absolute top-1 right-1 flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
          active ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

export function TerminalVariantB() {
  const { scenario, terminals, activeId, active, setScenario, select, create, close, wake } =
    useTerminalScenario()
  const asleep = scenario === ETerminalScenario.Asleep
  const live = terminals.filter((terminal) => terminal.status === ETerminalStatus.Live).length

  const renderBody = () => {
    if (asleep) return <DisconnectedBody onWake={wake} />
    if (!active) return <EmptyBody onCreate={create} />
    if (active.status === ETerminalStatus.Ended) {
      return <EndedBody terminal={active} onClose={() => close(active.id)} />
    }
    return <LiveShell key={active.id} terminal={active} />
  }

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-44 shrink-0 flex-col border-r border-border">
        <div className="flex h-9 shrink-0 items-baseline justify-between px-2 pt-2">
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            terminals
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {live}/{MAX_PANE_TERMINALS}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 py-1">
          {terminals.map((terminal) => (
            <RailRow
              key={terminal.id}
              terminal={terminal}
              active={terminal.id === activeId}
              onSelect={() => select(terminal.id)}
              onClose={() => close(terminal.id)}
            />
          ))}
          {terminals.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">none yet</p>
          ) : null}
        </div>
        <div className="shrink-0 border-t border-border p-1">
          <Button
            size="xs"
            variant="ghost"
            className="w-full justify-start"
            disabled={asleep || live >= MAX_PANE_TERMINALS}
            onClick={create}
          >
            <PlusIcon data-icon="inline-start" />
            New terminal
          </Button>
        </div>
        <div className="flex shrink-0 justify-center border-t border-border p-1.5">
          <ScenarioSwitch scenario={scenario} onChange={setScenario} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              active ? STATUS_CLASS[active.status] : 'bg-muted-foreground/40',
            )}
          />
          <span className="min-w-0 truncate text-xs font-medium">
            {active?.label ?? 'No terminal'}
          </span>
          <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
            {active?.cwd ?? ''}
          </span>
          {active ? (
            <button
              type="button"
              aria-label={`Close ${active.label}`}
              onClick={() => close(active.id)}
              className="ml-auto flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{renderBody()}</div>
      </div>
    </div>
  )
}
