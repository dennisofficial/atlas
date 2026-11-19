'use client'

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PlusIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { MAX_TERMINALS } from '@dltech/atlas-protocol'

import {
  ETerminalTabState,
  type TerminalTab,
  isLiveTab,
  shellStateOf,
  tabLabelOf,
} from './terminal-model'

const DOT_CLASS: Record<ETerminalTabState, string> = {
  [ETerminalTabState.Opening]: 'bg-warning',
  [ETerminalTabState.Open]: 'bg-success',
  [ETerminalTabState.Ended]: 'bg-muted-foreground/40',
  [ETerminalTabState.Failed]: 'bg-destructive',
}

export function useOverflow(dep: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (node === null) return undefined
    const measure = () => setOverflowing(node.scrollWidth > node.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [dep])

  return { ref, overflowing }
}

function TerminalChip(props: {
  tab: TerminalTab
  active: boolean
  onSelect: () => void
  onClose: () => void
  onRename: (name: string) => void
}) {
  const { tab, active } = props
  const [editing, setEditing] = useState(false)
  const ended = tab.state === ETerminalTabState.Ended
  const label = tab.row.name || tabLabelOf(tab.row)

  const handleCommit = (value: string) => {
    setEditing(false)
    const next = value.trim()
    if (next.length > 0 && next !== tab.row.name) props.onRename(next)
  }

  const handleDoubleClick = () => setEditing(true)

  return (
    <div
      className={cn(
        'group/tab relative flex h-full max-w-40 shrink-0 items-center border-r border-border text-xs',
        active ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground',
        ended && !active && 'opacity-60',
      )}
    >
      {active ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-primary" /> : null}
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[tab.state])} />
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: renaming starts from the tab the user double-clicked
          autoFocus
          aria-label={`Rename ${label}`}
          defaultValue={tab.row.name}
          onBlur={(event) => handleCommit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCommit(event.currentTarget.value)
            if (event.key === 'Escape') setEditing(false)
          }}
          className="mx-1 h-5 w-24 min-w-0 rounded-sm border border-border bg-background px-1 font-mono text-[11px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={props.onSelect}
          onDoubleClick={handleDoubleClick}
          aria-pressed={active}
          title={label}
          className="flex h-full min-w-0 items-center gap-1.5 pr-1 pl-1.5 whitespace-nowrap outline-none"
        >
          <span className={cn('truncate', ended && 'line-through decoration-muted-foreground/50')}>
            {label}
          </span>
        </button>
      )}
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={props.onClose}
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

function OverflowRow(props: {
  tab: TerminalTab
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  const { tab, active } = props
  return (
    <div
      className={cn(
        'group/row flex items-center gap-1 rounded pl-1.5',
        active ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        onClick={props.onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
      >
        <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className={cn('truncate text-xs', active && 'font-medium')}>
              {tab.row.name || tabLabelOf(tab.row)}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {shellStateOf(tab)}
            </span>
          </span>
          {tab.cwd === undefined ? null : (
            <span className="block truncate font-mono text-[10px] text-muted-foreground/80">
              {tab.cwd}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${tab.row.name || tabLabelOf(tab.row)}`}
        onClick={props.onClose}
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

export function TerminalStrip(props: {
  tabs: readonly TerminalTab[]
  activeId: string | undefined
  canCreate: boolean
  onSelect: (terminalId: string) => void
  onClose: (terminalId: string) => void
  onRename: (terminalId: string, name: string) => void
  onNew: () => void
}) {
  const [open, setOpen] = useState(false)
  const { tabs, activeId } = props
  const { ref, overflowing } = useOverflow(tabs.length)

  const handleSelect = (terminalId: string) => {
    props.onSelect(terminalId)
    setOpen(false)
  }

  const handleClose = (terminalId: string) => {
    props.onClose(terminalId)
    setOpen(false)
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-muted/30 pr-1.5">
      <div ref={ref} className="flex h-full min-w-0 flex-1 items-stretch overflow-hidden">
        {tabs.map((tab) => (
          <TerminalChip
            key={tab.row.terminalId}
            tab={tab}
            active={tab.row.terminalId === activeId}
            onSelect={() => handleSelect(tab.row.terminalId)}
            onClose={() => handleClose(tab.row.terminalId)}
            onRename={(name) => props.onRename(tab.row.terminalId, name)}
          />
        ))}
      </div>
      {overflowing ? (
        <div className="relative shrink-0">
          <Button
            size="icon-xs"
            variant={open ? 'secondary' : 'ghost'}
            title="All terminals"
            aria-label="All terminals"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="relative z-30"
          >
            <ChevronDownIcon />
          </Button>
          {open ? (
            <>
              <button
                type="button"
                aria-label="Close terminal list"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-20 cursor-default"
              />
              <div className="absolute top-full right-0 z-30 mt-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-xl">
                <div className="flex items-center justify-between px-1.5 pt-0.5 pb-1">
                  <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                    shells
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {tabs.length}
                  </span>
                </div>
                {tabs.map((tab) => (
                  <OverflowRow
                    key={tab.row.terminalId}
                    tab={tab}
                    active={tab.row.terminalId === activeId}
                    onSelect={() => handleSelect(tab.row.terminalId)}
                    onClose={() => handleClose(tab.row.terminalId)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost"
        title={props.canCreate ? 'New terminal' : `At most ${MAX_TERMINALS} terminals`}
        aria-label="New terminal"
        disabled={!props.canCreate}
        onClick={props.onNew}
        className="shrink-0"
      >
        <PlusIcon />
      </Button>
    </div>
  )
}

export function TerminalBreadcrumb({ cwd }: { cwd: string }) {
  const segments = cwd.split('/').filter((segment) => segment.length > 0)
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/70 px-2">
      <FolderIcon className="size-3 shrink-0 text-muted-foreground/70" />
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
          {index > 0 ? (
            <ChevronRightIcon className="size-2.5 shrink-0 text-muted-foreground/40" />
          ) : null}
          <span
            className={cn(
              'truncate font-mono text-[11px]',
              index === segments.length - 1 ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {segment}
          </span>
        </span>
      ))}
    </div>
  )
}

export function TerminalStatusBar(props: { tab: TerminalTab | undefined; count: number }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 border-t border-border bg-muted/20 pr-2 pl-2">
      {props.tab === undefined ? (
        <span className="font-mono text-[10px] text-muted-foreground">no shell</span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span>{isLiveTab(props.tab) ? 'zsh' : 'shell'}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="truncate">{shellStateOf(props.tab)}</span>
        </span>
      )}
      <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
        {props.count} {props.count === 1 ? 'terminal' : 'terminals'}
      </span>
    </div>
  )
}
