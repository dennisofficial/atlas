import {
  type MemoryDraft,
  type MemoryEntry,
  type MemoryKey,
  type MemoryScopeGroup,
  buildMemoryGroups,
  memoryKeyInput,
  summaryToEntry,
} from '@dltech/atlas-client/settings'

import { api, cloudCall } from '@/lib/api-client'

export { memoryKeyInput, summaryToEntry, buildMemoryGroups }
export type { MemoryDraft, MemoryKey }

export const buildGroups = buildMemoryGroups

export async function fetchMemoryGroups(): Promise<MemoryScopeGroup[]> {
  const [body, groups] = await Promise.all([
    cloudCall(api.memories.listAll.query()),
    cloudCall(api.projectGroups.list.query()),
  ])
  return buildMemoryGroups({
    memories: body.memories,
    groupNames: new Map(groups.groups.map((group) => [group.id, group.name])),
  })
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
