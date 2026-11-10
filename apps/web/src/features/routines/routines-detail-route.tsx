'use client'

import { EQueryState } from '@/lib/use-cloud-query'
import { useRouteParam } from '@/lib/route-param'

import { useRoutines } from './data/routines-api'
import { RoutineDetail } from './routine-detail'

export function RoutineDetailRoute() {
  const routineId = useRouteParam('routineId')
  const routines = useRoutines()
  if (routines.state === EQueryState.Failed) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        Routines did not load: {routines.error.message}
      </div>
    )
  }
  if (routines.state === EQueryState.Loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading routine…
      </div>
    )
  }
  const routine = routines.data.find((candidate) => candidate.routineId === routineId)
  if (routine === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No routine with id {routineId}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RoutineDetail routine={routine} />
    </div>
  )
}
