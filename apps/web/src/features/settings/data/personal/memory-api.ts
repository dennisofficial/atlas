import { EMemoryScope, type MemorySummary } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import {
  MEMORY_GLOBAL_GROUP_ID,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '../../fixtures/settings-memory-types'

export type MemoryKey = { scope: EMemoryScope; project: string | null; name: string }

export type MemoryDraft = MemoryKey & Pick<MemoryEntry, 'description' | 'type' | 'body'>

export const memoryKeyInput = (key: MemoryKey) => ({
  scope: key.scope,
  name: key.name,
  ...(key.project === null ? {} : { project: key.project }),
})

export function summaryToEntry(summary: MemorySummary): MemoryEntry {
  return {
    name: summary.name,
    description: summary.description,
    type: summary.type,
    body: '',
    revision: summary.revision,
    updatedAt: summary.updatedAt,
  }
}

export function buildGroups(memories: readonly MemorySummary[]): MemoryScopeGroup[] {
  const globalGroup: MemoryScopeGroup = {
    id: MEMORY_GLOBAL_GROUP_ID,
    scope: EMemoryScope.Global,
    project: null,
    memories: [],
  }
  const projectGroups = new Map<string, MemoryScopeGroup>()
  for (const memory of memories) {
    if (memory.scope === EMemoryScope.Global || memory.project === null) {
      if (memory.scope === EMemoryScope.Global) globalGroup.memories.push(summaryToEntry(memory))
      continue
    }
    const group = projectGroups.get(memory.project) ?? {
      id: memory.project,
      scope: EMemoryScope.Project,
      project: memory.project,
      memories: [],
    }
    group.memories.push(summaryToEntry(memory))
    projectGroups.set(memory.project, group)
  }
  return [globalGroup, ...projectGroups.values()]
}

export async function fetchMemoryGroups(): Promise<MemoryScopeGroup[]> {
  const body = await cloudCall(api.memories.listAll.query())
  return buildGroups(body.memories)
}

export function fetchMemoryEntry(key: MemoryKey): Promise<MemoryEntry> {
  return cloudCall(api.memories.get.query(memoryKeyInput(key)))
}

export async function putMemory(draft: MemoryDraft): Promise<void> {
  await cloudCall(
    api.memories.put.mutate({
      ...memoryKeyInput(draft),
      description: draft.description,
      type: draft.type,
      body: draft.body,
    }),
  )
}

export function deleteMemory(key: MemoryKey): Promise<void> {
  return cloudCall(api.memories.remove.mutate(memoryKeyInput(key)))
}
