'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import type { MemoryEntry, MemoryScopeGroup } from './fixtures/settings-memory'
import {
  deleteMemory,
  fetchMemoryGroups,
  putMemory,
  type MemoryKey,
} from './data/personal/memory-api'
import { useSaveAction } from './data/personal/use-save-action'

export type MemoryGroups = {
  query: CloudQuery<MemoryScopeGroup[]>
  saving: boolean
  saveMemory: (args: { group: MemoryScopeGroup; entry: MemoryEntry }) => Promise<boolean>
  deleteMemories: (args: { group: MemoryScopeGroup; names: string[] }) => Promise<boolean>
}

const keyOf = (args: { group: MemoryScopeGroup; name: string }): MemoryKey => ({
  scope: args.group.scope,
  project: args.group.project,
  name: args.name,
})

export function useMemoryGroups(): MemoryGroups {
  const query = useCloudQuery({ key: 'personal-memory', load: fetchMemoryGroups })
  const { reload } = query
  const { saving, run } = useSaveAction()

  const saveMemory = useCallback(
    async (args: { group: MemoryScopeGroup; entry: MemoryEntry }) => {
      const key = keyOf({ group: args.group, name: args.entry.name })
      const saved = await run({
        work: () =>
          putMemory({
            ...key,
            description: args.entry.description,
            type: args.entry.type,
            body: args.entry.body,
          }),
        success: 'Memory saved',
      })
      if (saved) reload()
      return saved
    },
    [run, reload],
  )

  const deleteMemories = useCallback(
    async (args: { group: MemoryScopeGroup; names: string[] }) => {
      const deleted = await run({
        work: async () => {
          try {
            for (const name of args.names) await deleteMemory(keyOf({ group: args.group, name }))
          } finally {
            reload()
          }
        },
        success: args.names.length === 1 ? 'Memory deleted' : `${args.names.length} memories deleted`,
      })
      return deleted
    },
    [run, reload],
  )

  return { query, saving, saveMemory, deleteMemories }
}
