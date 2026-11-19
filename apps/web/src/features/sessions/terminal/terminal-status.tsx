'use client'

import { ChevronRightIcon, FolderIcon, TriangleAlertIcon } from 'lucide-react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { type TerminalProblem, type TerminalTab, isLiveTab, shellStateOf } from './terminal-model'

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

export function TerminalProblemBar({ problem }: { problem: TerminalProblem }) {
  return (
    <div
      role="status"
      data-terminal-problem={problem.op}
      className="flex h-7 shrink-0 items-center gap-1.5 border-t border-border bg-muted/40 px-2 text-xs text-muted-foreground"
    >
      <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate" title={problem.message}>
        {problem.message}
      </span>
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
