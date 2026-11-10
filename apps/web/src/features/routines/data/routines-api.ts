'use client'

import type {
  Routine,
  RoutineCreateInput,
  RoutineRunRow,
  RoutineUpdateInput,
} from '@dltech/atlas-protocol'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'

import { api, cloudCall } from '@/lib/api-client'
import { ROUTINES_KEY, ROUTINE_RUNS_KEY } from '@/lib/cloud-keys'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'
import { type CloudQuery, useCloudQuery } from '@/lib/use-cloud-query'

const RUNS_LIMIT = 20

export const fetchRoutines = async (): Promise<readonly Routine[]> =>
  (await cloudCall(api.routines.list.query({}))).routines

export const fetchRoutineRuns = async (routineId: string): Promise<readonly RoutineRunRow[]> =>
  (await cloudCall(api.routines.runs.query({ routineId, limit: RUNS_LIMIT }))).runs

export const createRoutine = (input: RoutineCreateInput) =>
  cloudCall(api.routines.create.mutate(input))

export const updateRoutine = (input: RoutineUpdateInput) =>
  cloudCall(api.routines.update.mutate(input))

export const removeRoutine = (routineId: string) =>
  cloudCall(api.routines.remove.mutate({ routineId }))

export const runRoutineNow = (routineId: string) =>
  cloudCall(api.routines.runNow.mutate({ routineId }))

export const routineRunsKeyOf = (routineId: string): string => `${ROUTINE_RUNS_KEY}:${routineId}`

export function useRoutines(): CloudQuery<readonly Routine[]> {
  return useCloudQuery({ key: ROUTINES_KEY, load: fetchRoutines })
}

export function useRoutineRuns(routineId: string): CloudQuery<readonly RoutineRunRow[]> {
  const load = useCallback(() => fetchRoutineRuns(routineId), [routineId])
  return useCloudQuery({ key: routineRunsKeyOf(routineId), load })
}

export function useCreateRoutine() {
  const invalidate = useInvalidateCloud()
  return useMutation({
    mutationFn: createRoutine,
    onSuccess: () => invalidate([ROUTINES_KEY]),
  })
}

export function useUpdateRoutine() {
  const invalidate = useInvalidateCloud()
  return useMutation({
    mutationFn: updateRoutine,
    onSuccess: () => invalidate([ROUTINES_KEY]),
  })
}

export function useRemoveRoutine() {
  const invalidate = useInvalidateCloud()
  return useMutation({
    mutationFn: removeRoutine,
    onSuccess: () => invalidate([ROUTINES_KEY]),
  })
}

export function useRunRoutineNow() {
  return useMutation({ mutationFn: runRoutineNow })
}
