'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { usePrototype } from '@/proto/use-prototype'

import { RoutineCreateSheet } from './routine-create-sheet'
import { RoutineDetail } from './routine-detail'
import { RoutinesEmpty } from './routines-empty'
import { ROUTINE_CONTROLS, routinesOfParams } from './routines-tweaks'

export function RoutinesIndexRoute() {
  usePrototype(ROUTINE_CONTROLS)
  const params = useSearchParams()
  const routines = routinesOfParams(params)
  const [createOpen, setCreateOpen] = useState(() => params.get('new') === '1')
  const first = routines[0]
  return (
    <div className="flex h-full min-h-0 flex-col">
      {first === undefined ? (
        <RoutinesEmpty onCreate={() => setCreateOpen(true)} />
      ) : (
        <RoutineDetail routine={first} />
      )}
      <RoutineCreateSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
