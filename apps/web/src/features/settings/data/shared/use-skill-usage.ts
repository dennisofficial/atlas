'use client'

import { useQueries } from '@tanstack/react-query'
import { skillUsageKeyOf } from '@dltech/atlas-client/settings'
import type { SkillScopeInput } from '@dltech/atlas-wire/web'
import { listSkillUsage } from './skills-api'

export function useSkillUsage(targets: readonly SkillScopeInput[]) {
  const unique = [...new Map(targets.map((target) => [skillUsageKeyOf(target), target])).values()]
  const queries = useQueries({
    queries: unique.map((target) => ({
      queryKey: [skillUsageKeyOf(target)],
      queryFn: () => listSkillUsage(target),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  })
  return new Map(unique.map((target, index) => [skillUsageKeyOf(target), queries[index]?.data]))
}
