'use client'

import { skipToken, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { WireThread } from '@dltech/atlas-wire/web'

import { SHELL_THREADS_KEY } from '@/lib/cloud-keys'

import { descendantsOfThread, type ProjectThreads } from './thread-partition'

const NONE: readonly WireThread[] = []

export function useSessionFamily(threadId: string): readonly WireThread[] {
  const query = useQuery<{ value: { entries: ProjectThreads[] } }>({
    queryKey: [SHELL_THREADS_KEY],
    queryFn: skipToken,
  })
  const entries = query.data?.value.entries
  return useMemo(
    () => (entries === undefined ? NONE : descendantsOfThread({ entries, threadId })),
    [entries, threadId],
  )
}
