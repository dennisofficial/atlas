import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { SidebarMenu } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ThreadRow } from './shell-thread-row'
import {
  countThreads,
  hasThread,
  projectKeyOf,
  projectNameOf,
  type ProjectThreads,
} from './thread-partition'

export interface BucketProps {
  label: string
  hint?: string
  entries: readonly ProjectThreads[]
  total?: number | undefined
  onShowAll?: (() => void) | undefined
  activeThreadId: string | null
}

export function Bucket({ label, hint, entries, total, onShowAll, activeThreadId }: BucketProps) {
  const [open, setOpen] = useState(
    () => activeThreadId !== null && hasThread({ entries, threadId: activeThreadId }),
  )
  const shown = countThreads(entries)
  const count = total ?? shown
  const handleToggle = () => setOpen((current) => !current)
  return (
    <section className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <ChevronRight className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="shrink-0">{label}</span>
        {hint && <span className="shrink-0 text-xs opacity-70">{hint}</span>}
        <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
        <span className="font-mono text-xs tabular-nums">{count}</span>
      </button>
      {onShowAll !== undefined && count > shown && (
        <button
          type="button"
          onClick={onShowAll}
          className="flex h-7 w-full items-center rounded-md px-2 pl-7.5 text-xs text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          Show all {count} →
        </button>
      )}
      {open &&
        entries.map(({ project, sessions }) => (
          <div key={projectKeyOf(project)} className="flex flex-col gap-0.5">
            <p className="truncate px-2 pt-1 text-xs text-muted-foreground">
              {projectNameOf(project)}
            </p>
            <SidebarMenu>
              {sessions.map((session) => (
                <ThreadRow
                  key={session.id}
                  session={session}
                  projectName={projectNameOf(project)}
                  activeThreadId={activeThreadId}
                />
              ))}
            </SidebarMenu>
          </div>
        ))}
    </section>
  )
}
