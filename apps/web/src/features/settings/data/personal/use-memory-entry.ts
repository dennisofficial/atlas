'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import type { MemoryEntry, MemoryScopeGroup } from '../../fixtures/settings-memory-types'
import { fetchMemoryEntry } from './memory-api'

export function useMemoryEntry(args: {
  group: MemoryScopeGroup
  summary: MemoryEntry | null
}): CloudQuery<MemoryEntry | null> {
  const { scope, project } = args.group
  const name = args.summary?.name ?? null
  const load = useCallback(
    () => (name === null ? Promise.resolve(null) : fetchMemoryEntry({ scope, project, name })),
    [scope, project, name],
  )
  const key = `memory-entry:${scope}:${project}:${name}:${args.summary?.revision}`
  return useCloudQuery({ key, load })
}
