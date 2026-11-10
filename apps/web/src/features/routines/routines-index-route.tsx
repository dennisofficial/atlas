'use client'

import { useRouter, useSearchParams } from 'next/navigation'

import { EQueryState } from '@/lib/use-cloud-query'

import { useRoutines } from './data/routines-api'
import { RoutineCreateSheet } from './routine-create-sheet'
import { RoutineDetail } from './routine-detail'
import { RoutinesEmpty } from './routines-empty'

const ROUTINES_HREF = '/routines'
const NEW_ROUTINE_HREF = '/routines?new=1'

export function RoutinesIndexRoute() {
  const params = useSearchParams()
  const router = useRouter()
  const routines = useRoutines()
  const createOpen = params.get('new') === '1'
  const first = routines.data?.[0]

  const handleCreateOpenChange = (open: boolean) => {
    router.replace(open ? NEW_ROUTINE_HREF : ROUTINES_HREF)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {routines.state === EQueryState.Failed ? (
        <div className="flex h-full items-center justify-center text-sm text-destructive">
          Routines did not load: {routines.error.message}
        </div>
      ) : first === undefined ? (
        <RoutinesEmpty onCreate={() => handleCreateOpenChange(true)} />
      ) : (
        <RoutineDetail routine={first} />
      )}
      <RoutineCreateSheet
        open={createOpen}
        onOpenChange={handleCreateOpenChange}
        defaultProjectId={first?.projectId ?? ''}
      />
    </div>
  )
}
