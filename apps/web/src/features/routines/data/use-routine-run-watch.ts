'use client'

import type { Routine } from '@dltech/atlas-protocol'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useV2Sessions } from '@/features/shell/use-v2-sessions'
import { ROUTINES_KEY } from '@/lib/cloud-keys'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'

import { type RoutineFeedRun, routineFeedInvalidationsOf, routineRunsOf } from '../routine-feed'
import { routineRunsKeyOf } from './routines-api'

const loadedRoutines = (client: QueryClient): readonly Routine[] | undefined =>
  client.getQueryData<{ value: readonly Routine[] }>([ROUTINES_KEY])?.value

export function useRoutineRunWatch(): void {
  const client = useQueryClient()
  const invalidate = useInvalidateCloud()
  const sessions = useV2Sessions()
  const seen = useRef<readonly RoutineFeedRun[] | null>(null)

  useEffect(() => {
    const routines = loadedRoutines(client)
    if (routines === undefined) return
    const runs = routineRunsOf(sessions)
    const previous = seen.current
    seen.current = runs
    if (previous === null) return
    const routineIds = routineFeedInvalidationsOf({ seen: previous, runs, routines })
    if (routineIds.length === 0) return
    void invalidate([ROUTINES_KEY, ...routineIds.map(routineRunsKeyOf)])
  }, [client, invalidate, sessions])
}
