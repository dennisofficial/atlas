import { useState } from 'react'

import type { MemoryEntry, MemoryScopeGroup } from '../../fixtures/settings-memory'

export function useMemoryGroups(initial: MemoryScopeGroup[]) {
  const [groups, setGroups] = useState(initial)

  const updateGroup = ({
    groupId,
    update,
  }: {
    groupId: string
    update: (group: MemoryScopeGroup) => MemoryScopeGroup
  }) =>
    setGroups((current) => current.map((group) => (group.id === groupId ? update(group) : group)))

  const deleteMemories = ({ groupId, names }: { groupId: string; names: string[] }) =>
    updateGroup({
      groupId,
      update: (group) => ({
        ...group,
        memories: group.memories.filter((entry) => !names.includes(entry.name)),
      }),
    })

  const saveMemory = ({ groupId, entry }: { groupId: string; entry: MemoryEntry }) =>
    updateGroup({
      groupId,
      update: (group) => ({
        ...group,
        memories: group.memories.map((candidate) =>
          candidate.name === entry.name ? entry : candidate,
        ),
      }),
    })

  const clearGroup = (groupId: string) =>
    updateGroup({ groupId, update: (group) => ({ ...group, memories: [] }) })

  return { groups, deleteMemories, saveMemory, clearGroup }
}
