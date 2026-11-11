'use client'

import { ChevronRight, FolderGit2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import type { Routine } from '@dltech/atlas-protocol'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { useClock } from '@/features/shell/use-clock'
import { useV2Sessions } from '@/features/shell/use-v2-sessions'
import { fetchProjects } from '@/features/threads/data/threads-api'
import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { useRoutineRunWatch } from './data/use-routine-run-watch'
import { useRoutines } from './data/routines-api'
import { metaLineOf } from './routine-meta'
import { routineGroupsOf } from './routine-groups'
import { pushedSessionStateOf, routineStateOf } from './routine-state'
import { RoutineStatusWord } from './routine-status'

function RoutineRow({ routine, active, now }: { routine: Routine; active: boolean; now: number }) {
  const sessions = useV2Sessions()
  const sessionState = pushedSessionStateOf({ sessionId: routine.lastSessionId, sessions })
  const state = routineStateOf({ routine, sessionState })
  return (
    <Link
      href={`/routines/${encodeURIComponent(routine.routineId)}`}
      aria-current={active ? 'page' : undefined}
      data-routine-row={routine.routineId}
      className={cn(
        'flex flex-col gap-0.5 rounded-md px-2 py-1.5 outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active && 'bg-sidebar-accent',
        !routine.enabled && 'opacity-70',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{routine.name}</span>
        <RoutineStatusWord state={state} />
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {metaLineOf({ routine, state, now, timeZone: routine.timezone })}
      </span>
    </Link>
  )
}

function RoutineProjectGroup({
  name,
  routines,
  activeRoutineId,
  open,
  now,
  onOpenChange,
}: {
  name: string
  routines: readonly Routine[]
  activeRoutineId: string | null
  open: boolean
  now: number
  onOpenChange: (open: boolean) => void
}) {
  const handleToggle = () => onOpenChange(!open)
  return (
    <section data-routine-group={name} className="flex flex-col gap-0.5">
      <div className="flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-sidebar-accent">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-sm font-medium outline-hidden"
        >
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </button>
        <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {routines.length}
        </span>
        <button
          type="button"
          onClick={handleToggle}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          className="shrink-0 text-muted-foreground outline-hidden"
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-0.5">
          {routines.map((routine) => (
            <RoutineRow
              key={routine.routineId}
              routine={routine}
              active={routine.routineId === activeRoutineId}
              now={now}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function RoutineSidebarList({ activeRoutineId }: { activeRoutineId: string | null }) {
  const now = useClock()
  useRoutineRunWatch()
  const routines = useRoutines()
  const projects = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  const [collapsed, setCollapsed] = useState<string[]>([])

  if (routines.state === EQueryState.Loading) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading routines…</p>
  }
  if (routines.state === EQueryState.Failed) {
    return (
      <p className="px-3 py-2 text-xs text-destructive">
        Routines did not load: {routines.error.message}
      </p>
    )
  }
  if (routines.data.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No routines yet. Create one with the plus above.
      </p>
    )
  }
  const groups = routineGroupsOf({
    routines: routines.data,
    projects: projects.state === EQueryState.Ready ? projects.data : [],
  })

  return (
    <div className="flex flex-col gap-1 p-2">
      {groups.map((group) => (
        <RoutineProjectGroup
          key={group.key}
          name={group.name}
          routines={group.routines}
          activeRoutineId={activeRoutineId}
          open={!collapsed.includes(group.key)}
          now={now}
          onOpenChange={(next) =>
            setCollapsed((current) =>
              next ? current.filter((key) => key !== group.key) : [...current, group.key],
            )
          }
        />
      ))}
    </div>
  )
}
