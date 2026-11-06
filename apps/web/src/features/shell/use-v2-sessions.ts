'use client'

import { useQuery } from '@tanstack/react-query'

import { fetchV2Sessions } from '@/features/sessions/data/sessions-api'
import { V2_SESSIONS_KEY } from '@/lib/cloud-keys'

import type { V2SessionSummary } from './v2-rows'

export const V2_SESSIONS_REFETCH_MS = 15_000

const NONE: readonly V2SessionSummary[] = []

export function useV2Sessions(): readonly V2SessionSummary[] {
  const query = useQuery({
    queryKey: [V2_SESSIONS_KEY],
    queryFn: fetchV2Sessions,
    refetchInterval: V2_SESSIONS_REFETCH_MS,
    refetchOnWindowFocus: true,
  })
  return query.data ?? NONE
}
