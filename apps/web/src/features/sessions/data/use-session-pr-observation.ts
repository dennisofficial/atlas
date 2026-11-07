'use client'

import { useMemo } from 'react'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'
import { EPrObservationPriority } from '@/features/threads/data/pr-observation-targets'
import { useApiPrStates } from '@/features/threads/data/use-api-pr-states'
import {
  usePrObservationRef,
  usePrObservationRegistry,
} from '@/features/threads/data/use-pr-observation'

export function useSessionPrObservation(entries: readonly PullRequestEntry[]) {
  const { registry, observe } = usePrObservationRegistry()
  const targets = useMemo(
    () =>
      entries.map(({ repo, number }) => ({
        repo,
        number,
        priority: EPrObservationPriority.Inline,
      })),
    [entries],
  )
  const ref = usePrObservationRef({ registry, targets })
  useApiPrStates({ observe })
  return ref
}
