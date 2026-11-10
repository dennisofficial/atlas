'use client'

import { useParams, useSearchParams } from 'next/navigation'

import { usePrototype } from '@/proto/use-prototype'

import { RoutineDetail } from './routine-detail'
import { ROUTINE_CONTROLS, routinesOfParams } from './routines-tweaks'

export function RoutineDetailRoute() {
  usePrototype(ROUTINE_CONTROLS)
  const params = useParams<{ routineId: string }>()
  const routines = routinesOfParams(useSearchParams())
  const routine = routines.find((candidate) => candidate.id === params.routineId)
  if (routine === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No routine with id {params.routineId}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RoutineDetail routine={routine} />
    </div>
  )
}
