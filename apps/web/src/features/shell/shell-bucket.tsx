import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { SidebarMenu } from '@dltech/atlas-ui/components/sidebar'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ThreadRow } from './shell-thread-row'
import { countThreads, hasThread, type ProjectThreads } from './thread-partition'

export interface BucketProps {
  label: string
  hint?: string
  entries: readonly ProjectThreads[]
  activeThreadId: string | null
}

export function Bucket({ label, hint, entries, activeThreadId }: BucketProps) {
  const [open, setOpen] = useState(
    () => activeThreadId !== null && hasThread({ entries, threadId: activeThreadId }),
  )
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
        <span className="font-mono text-xs tabular-nums">{countThreads(entries)}</span>
      </button>
      {open &&
        entries.map(({ project, threads }) => (
          <div key={project.id} className="flex flex-col gap-0.5">
            <p className="truncate px-2 pt-1 text-xs text-muted-foreground">{project.name}</p>
            <SidebarMenu>
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  projectName={project.name}
                  active={thread.id === activeThreadId}
                />
              ))}
            </SidebarMenu>
          </div>
        ))}
    </section>
  )
}
