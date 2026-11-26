import { EMemoryScope, type MemorySummary } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import {
  MEMORY_GLOBAL_GROUP_ID,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '../../fixtures/settings-memory-types'

export type MemoryKey = {
  scope: EMemoryScope
  project: string | null
  groupId: string | null
  name: string
}

export type MemoryDraft = MemoryKey & Pick<MemoryEntry, 'description' | 'type' | 'body'>

export const memoryKeyInput = (key: MemoryKey) => ({
  scope: key.scope,
  name: key.name,
  ...(key.project === null ? {} : { project: key.project }),
  ...(key.groupId === null ? {} : { groupId: key.groupId }),
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

export function buildGroups(args: {
  memories: readonly MemorySummary[]
  groupNames: ReadonlyMap<string, string>
}): MemoryScopeGroup[] {
  const globalGroup: MemoryScopeGroup = {
    id: MEMORY_GLOBAL_GROUP_ID,
    scope: EMemoryScope.Global,
    project: null,
    groupId: null,
    name: null,
    memories: [],
  }
  const groupScopes = new Map<string, MemoryScopeGroup>()
  const projectGroups = new Map<string, MemoryScopeGroup>()
  for (const memory of args.memories) {
    if (memory.scope === EMemoryScope.Global) {
      globalGroup.memories.push(summaryToEntry(memory))
      continue
    }
    if (memory.scope === EMemoryScope.Group) {
      if (memory.groupId === null) continue
      const scope =
        groupScopes.get(memory.groupId) ??
        ({
          id: `group:${memory.groupId}`,
          scope: EMemoryScope.Group,
          project: null,
          groupId: memory.groupId,
          name: args.groupNames.get(memory.groupId) ?? null,
          memories: [],
        } satisfies MemoryScopeGroup)
      scope.memories.push(summaryToEntry(memory))
      groupScopes.set(memory.groupId, scope)
      continue
    }
    if (memory.project === null) continue
    const project =
      projectGroups.get(memory.project) ??
      ({
        id: memory.project,
        scope: EMemoryScope.Project,
        project: memory.project,
        groupId: null,
        name: null,
        memories: [],
      } satisfies MemoryScopeGroup)
    project.memories.push(summaryToEntry(memory))
    projectGroups.set(memory.project, project)
  }
  return [globalGroup, ...groupScopes.values(), ...projectGroups.values()]
}

export async function fetchMemoryGroups(): Promise<MemoryScopeGroup[]> {
  const [body, groups] = await Promise.all([
    cloudCall(api.memories.listAll.query()),
    cloudCall(api.projectGroups.list.query()),
  ])
  return buildGroups({
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
