import type { ApiClient } from '@dltech/atlas-api-router'
import {
  type MemoryEntry,
  type MemoryKey,
  type MemoryScopeGroup,
  buildMemoryGroups,
  memoryKeyInput,
} from '@dltech/atlas-client/settings'

export const loadMemoryGroups = async ({
  api,
}: {
  api: ApiClient
}): Promise<MemoryScopeGroup[]> => {
  const [body, groups] = await Promise.all([
    api.memories.listAll.query(),
    api.projectGroups.list.query(),
  ])
  return buildMemoryGroups({
    memories: body.memories,
    groupNames: new Map(groups.groups.map((group) => [group.id, group.name])),
  })
}

export const loadMemoryEntry = ({
  api,
  key,
}: {
  api: ApiClient
  key: MemoryKey
}): Promise<MemoryEntry> => api.memories.get.query(memoryKeyInput(key))

export const saveMemoryEntry = async ({
  api,
  key,
  description,
  type,
  body,
}: {
  api: ApiClient
  key: MemoryKey
  description: string
  type: MemoryEntry['type']
  body: string
}): Promise<void> => {
  await api.memories.put.mutate({
    ...memoryKeyInput(key),
    description,
    type,
    body,
  })
}

export const deleteMemoryEntry = async ({
  api,
  key,
}: {
  api: ApiClient
  key: MemoryKey
}): Promise<void> => {
  await api.memories.remove.mutate(memoryKeyInput(key))
}
