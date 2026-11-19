import { ChevronDownIcon, TerminalIcon, Trash2Icon, XIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETerminalStatus, type PaneTerminal } from './terminal-scenario'

const DOT_CLASS: Record<ETerminalStatus, string> = {
  [ETerminalStatus.Live]: 'bg-success',
  [ETerminalStatus.Ended]: 'bg-muted-foreground/40',
  [ETerminalStatus.Disconnected]: 'bg-destructive',
}

export function shellState(terminal: PaneTerminal): string {
  if (terminal.status === ETerminalStatus.Live) return 'running'
  if (terminal.status === ETerminalStatus.Ended) {
    return terminal.exitCode === null ? 'ended' : `exit ${terminal.exitCode}`
  }
  return 'disconnected'
}

export interface ShellChipProps {
  terminal: PaneTerminal
  active: boolean
  onSelect: () => void
  onClose: () => void
}

export function ShellChip({ terminal, active, onSelect, onClose }: ShellChipProps) {
  const ended = terminal.status === ETerminalStatus.Ended
  return (
    <div
      className={cn(
        'group/tab relative flex h-full max-w-36 shrink-0 items-center border-r border-border text-xs',
        active ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
        ended && !active && 'opacity-60',
      )}
    >
      {active ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-primary" /> : null}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        title={terminal.label}
        className="flex h-full min-w-0 items-center gap-1.5 pr-1 pl-2.5 whitespace-nowrap outline-none"
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[terminal.status])} />
        <span className={cn('truncate', ended && 'line-through decoration-muted-foreground/50')}>
          {terminal.label}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${terminal.label}`}
        onClick={onClose}
        className={cn(
          'mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground',
          active
            ? 'opacity-100'
            : 'opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100',
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

interface ShellRowProps {
  terminal: PaneTerminal
  active: boolean
  onSelect: () => void
  onClose: () => void
}

function ShellRow({ terminal, active, onSelect, onClose }: ShellRowProps) {
  return (
    <div
      className={cn(
        'group/row flex items-center gap-1 rounded pl-1.5',
        active ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className={cn('truncate text-xs', active && 'font-medium')}>
              {terminal.label}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {shellState(terminal)}
            </span>
          </span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground/80">
            {terminal.cwd}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${terminal.label}`}
        onClick={onClose}
        className={cn(
          'mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:opacity-100',
          active ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
        )}
      >
        <Trash2Icon className="size-3" />
      </button>
    </div>
  )
}

export interface ShellOverflowProps {
  terminals: PaneTerminal[]
  activeId: string
  open: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export function ShellOverflow({
  terminals,
  activeId,
  open,
  onToggle,
  onSelect,
  onClose,
}: ShellOverflowProps) {
  return (
    <div className="relative shrink-0">
      <Button
        size="icon-xs"
        variant="ghost"
        title="All terminals"
        aria-label="All terminals"
        aria-expanded={open}
        onClick={onToggle}
        className={cn('relative z-30', open && 'bg-muted text-foreground')}
      >
        <ChevronDownIcon />
      </Button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close terminal list"
            onClick={onToggle}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div className="absolute top-full right-0 z-30 mt-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-xl">
            <div className="flex items-center justify-between px-1.5 pt-0.5 pb-1">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                shells
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {terminals.length}
              </span>
            </div>
            {terminals.map((terminal) => (
              <ShellRow
                key={terminal.id}
                terminal={terminal}
                active={terminal.id === activeId}
                onSelect={() => onSelect(terminal.id)}
                onClose={() => onClose(terminal.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
