'use client'

import { ChevronRight, FolderGit2 } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { PROJECTS } from '@/features/shell/fixtures/app'

import { RoutineStatusWord } from './routine-status'
import { metaLineOf } from './routine-meta'
import { type AppRoutine, stateOf } from './routines.fixtures'
import { routinesOfParams } from './routines-tweaks'

function RoutineRow({ routine, active }: { routine: AppRoutine; active: boolean }) {
  return (
    <Link
      href={`/routines/${routine.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col gap-0.5 rounded-md px-2 py-1.5 outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active && 'bg-sidebar-accent',
        !routine.enabled && 'opacity-70',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{routine.name}</span>
        <RoutineStatusWord state={stateOf(routine)} />
      </span>
      <span className="truncate text-xs text-muted-foreground">{metaLineOf(routine)}</span>
    </Link>
  )
}

function RoutineProjectGroup({
  projectName,
  routines,
  activeRoutineId,
  open,
  onOpenChange,
}: {
  projectName: string
  routines: readonly AppRoutine[]
  activeRoutineId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-sidebar-accent">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-sm font-medium outline-hidden"
        >
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{projectName}</span>
        </button>
        <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {routines.length}
        </span>
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-label={open ? `Collapse ${projectName}` : `Expand ${projectName}`}
          className="shrink-0 text-muted-foreground outline-hidden"
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-0.5">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              active={routine.id === activeRoutineId}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function RoutineSidebarList({ activeRoutineId }: { activeRoutineId?: string }) {
  const routines = routinesOfParams(useSearchParams())
  const [collapsed, setCollapsed] = useState<string[]>([])

  if (routines.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No routines yet. Create one with the plus above.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {PROJECTS.map((project) => {
        const projectRoutines = routines.filter((routine) => routine.projectId === project.id)
        if (projectRoutines.length === 0) return null
        const open = !collapsed.includes(project.id)
        return (
          <RoutineProjectGroup
            key={project.id}
            projectName={project.name}
            routines={projectRoutines}
            activeRoutineId={activeRoutineId ?? routines[0]?.id}
            open={open}
            onOpenChange={(next) =>
              setCollapsed((current) =>
                next ? current.filter((id) => id !== project.id) : [...current, project.id],
              )
            }
          />
        )
      })}
    </div>
  )
}
