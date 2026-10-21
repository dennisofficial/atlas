import {
  EMemoryScope,
  memoryEntrySchema,
  memoryListSchema,
  memorySummarySchema,
  type MemorySummary,
} from '@dltech/atlas-wire/web'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import {
  MEMORY_GLOBAL_GROUP_ID,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '../../fixtures/settings-memory-types'

export type MemoryKey = { scope: EMemoryScope; project: string | null; name: string }

export type MemoryDraft = MemoryKey & Pick<MemoryEntry, 'description' | 'type' | 'body'>

export function memoryQuery(key: MemoryKey): string {
  const params = new URLSearchParams({ scope: key.scope, name: key.name })
  if (key.project !== null) params.set('project', key.project)
  return params.toString()
}

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
  const body = await cloudJson({
    method: EHttpMethod.Get,
    path: '/v1/memories/all',
    schema: memoryListSchema,
  })
  return buildGroups(body.memories)
}

export function fetchMemoryEntry(key: MemoryKey): Promise<MemoryEntry> {
  return cloudJson({
    method: EHttpMethod.Get,
    path: `/v1/memories/entry?${memoryQuery(key)}`,
    schema: memoryEntrySchema,
  })
}

export async function putMemory(draft: MemoryDraft): Promise<void> {
  await cloudJson({
    method: EHttpMethod.Put,
    path: '/v1/memories/entry',
    body: {
      scope: draft.scope,
      ...(draft.project === null ? {} : { project: draft.project }),
      name: draft.name,
      description: draft.description,
      type: draft.type,
      body: draft.body,
    },
    schema: memorySummarySchema,
  })
}

export function deleteMemory(key: MemoryKey): Promise<void> {
  return cloudSend({ method: EHttpMethod.Delete, path: `/v1/memories/entry?${memoryQuery(key)}` })
}
