import { ChevronDownIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

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

interface PickerRowProps {
  terminal: PaneTerminal
  active: boolean
  onSelect: () => void
  onClose: () => void
}

function PickerRow({ terminal, active, onSelect, onClose }: PickerRowProps) {
  return (
    <div
      className={cn(
        'group/row flex items-center gap-2 px-2 py-1.5',
        active ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_CLASS[terminal.status])} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-xs font-medium">{terminal.label}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {STATUS_LABEL[terminal.status]}
            </span>
          </span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {terminal.cwd}
            {terminal.lastCommand ? ` · $ ${terminal.lastCommand}` : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${terminal.label}`}
        onClick={onClose}
        className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

export function TerminalVariantC() {
  const { scenario, terminals, activeId, active, setScenario, select, create, close, wake } =
    useTerminalScenario()
  const [open, setOpen] = useState(false)
  const asleep = scenario === ETerminalScenario.Asleep
  const live = terminals.filter((terminal) => terminal.status === ETerminalStatus.Live).length

  const handleSelect = (id: string) => {
    select(id)
    setOpen(false)
  }

  const renderBody = () => {
    if (asleep) return <DisconnectedBody onWake={wake} />
    if (!active) return <EmptyBody onCreate={create} />
    if (active.status === ETerminalStatus.Ended) {
      return <EndedBody terminal={active} onClose={() => close(active.id)} />
    }
    return <LiveShell key={active.id} terminal={active} className="px-0 py-0" />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label="Choose terminal"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted"
        >
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              active ? STATUS_CLASS[active.status] : 'bg-muted-foreground/40',
            )}
          />
          <span className="truncate text-xs font-medium">{active?.label ?? 'No terminal'}</span>
          <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
            {active?.cwd ?? ''}
          </span>
          <ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </button>
        <Button
          size="icon-xs"
          variant="ghost"
          title="New terminal"
          aria-label="New terminal"
          disabled={asleep || live >= MAX_PANE_TERMINALS}
          onClick={create}
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {open ? (
          <div className="absolute inset-x-2 top-1 z-10 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-2 py-1">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                sessions
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {live}/{MAX_PANE_TERMINALS}
              </span>
            </div>
            {terminals.map((terminal) => (
              <PickerRow
                key={terminal.id}
                terminal={terminal}
                active={terminal.id === activeId}
                onSelect={() => handleSelect(terminal.id)}
                onClose={() => close(terminal.id)}
              />
            ))}
            {terminals.length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-muted-foreground">No terminals yet.</p>
            ) : null}
            <div className="border-t border-border p-1">
              <Button
                size="xs"
                variant="ghost"
                className="w-full justify-start"
                disabled={asleep || live >= MAX_PANE_TERMINALS}
                onClick={() => {
                  create()
                  setOpen(false)
                }}
              >
                <PlusIcon data-icon="inline-start" />
                New terminal
              </Button>
            </div>
          </div>
        ) : null}
        {renderBody()}
      </div>
      <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border bg-muted/30 px-2">
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {asleep
            ? 'no shell · pod asleep'
            : active?.lastCommand
              ? `$ ${active.lastCommand}`
              : 'idle'}
        </span>
        <ScenarioSwitch scenario={scenario} onChange={setScenario} className="ml-auto" />
      </footer>
    </div>
  )
}
