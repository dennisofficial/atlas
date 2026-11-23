'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import type { UsageReportDto, UsageReportInput } from '@dltech/atlas-protocol'

import { fetchUsageReport, usageQueryKey } from '@/features/settings/data/personal/usage-api'

export type AccountUsage = { report: UsageReportDto | null }

const NO_INPUT_KEY = 'usage-none'

export function useAccountUsage(args: {
  input: UsageReportInput | null
  turnEnds: number
}): AccountUsage {
  const { input, turnEnds } = args
  const query = useQuery({
    queryKey: ['usage', input === null ? NO_INPUT_KEY : usageQueryKey(input)],
    queryFn: async () => (input === null ? null : fetchUsageReport(input)),
    enabled: input !== null,
  })
  const { refetch } = query
  const handledTurnEnd = useRef(0)

  useEffect(() => {
    if (turnEnds <= handledTurnEnd.current) return
    handledTurnEnd.current = turnEnds
    void refetch()
  }, [turnEnds, refetch])

  return { report: query.data ?? null }
}
