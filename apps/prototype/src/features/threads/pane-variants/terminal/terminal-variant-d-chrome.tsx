import { ChevronRightIcon, FolderIcon, Settings2Icon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { PaneTerminal } from './terminal-scenario'
import { shellState } from './terminal-variant-d-strip'

export function breadcrumbSegments(cwd: string): string[] {
  return cwd.split('/').filter((segment) => segment.length > 0)
}

export function TerminalBreadcrumb({ cwd }: { cwd: string }) {
  const segments = breadcrumbSegments(cwd)
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/70 px-2">
      <FolderIcon className="size-3 shrink-0 text-muted-foreground/70" />
      {segments.map((segment, index) => {
        const last = index === segments.length - 1
        return (
          <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <ChevronRightIcon className="size-2.5 shrink-0 text-muted-foreground/40" />
            ) : null}
            <span
              className={cn(
                'truncate font-mono text-[11px]',
                last ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {segment}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export interface TerminalStatusBarProps {
  terminal: PaneTerminal | undefined
  children?: ReactNode
}

export function TerminalStatusBar({ terminal, children }: TerminalStatusBarProps) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 border-t border-border bg-muted/20 pr-1 pl-2">
      {terminal ? (
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span>zsh</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="truncate">{shellState(terminal)}</span>
        </span>
      ) : (
        <span className="font-mono text-[10px] text-muted-foreground">no shell</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {children}
        <Button
          size="icon-xs"
          variant="ghost"
          title="Terminal settings"
          aria-label="Terminal settings"
        >
          <Settings2Icon />
        </Button>
      </div>
    </div>
  )
}
