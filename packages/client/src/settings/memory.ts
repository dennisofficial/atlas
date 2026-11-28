import {
  EMemoryScope,
  EMemoryType,
  MAX_MEMORY_BODY_CHARS,
  MAX_MEMORY_DESCRIPTION_CHARS,
  MEMORY_NAME_PATTERN,
  type MemorySummary,
} from '@dltech/atlas-wire/web'

export { EMemoryScope, EMemoryType, MEMORY_NAME_PATTERN }

export type MemoryEntry = {
  name: string
  description: string
  type: EMemoryType
  body: string
  revision: number
  updatedAt: string
}

export type MemoryScopeGroup = {
  id: string
  scope: EMemoryScope
  project: string | null
  groupId: string | null
  name: string | null
  memories: MemoryEntry[]
}

export type MemoryKey = {
  scope: EMemoryScope
  project: string | null
  groupId: string | null
  name: string
}

export type MemoryDraft = MemoryKey & Pick<MemoryEntry, 'description' | 'type' | 'body'>

export const MEMORY_MAX_DESCRIPTION_CHARS = MAX_MEMORY_DESCRIPTION_CHARS
export const MEMORY_MAX_BODY_CHARS = MAX_MEMORY_BODY_CHARS
export const MEMORY_GLOBAL_GROUP_ID = 'global'
export const MEMORY_ALL_TYPES = 'all'
export const MEMORY_TYPE_FILTERS: readonly string[] = [
  MEMORY_ALL_TYPES,
  ...Object.values(EMemoryType),
]

export const MEMORY_TYPE_LABELS: Record<EMemoryType, string> = {
  [EMemoryType.User]: 'User',
  [EMemoryType.Feedback]: 'Feedback',
  [EMemoryType.Project]: 'Project',
  [EMemoryType.Reference]: 'Reference',
}

export const MEMORY_TYPE_OPTIONS = Object.values(EMemoryType).map((type) => ({
  value: type,
  label: MEMORY_TYPE_LABELS[type],
}))

export const MEMORY_TYPE_FILTER_OPTIONS = [
  { value: MEMORY_ALL_TYPES, label: 'All' },
  ...MEMORY_TYPE_OPTIONS,
]

export const MEMORY_PAGE_TITLE = 'Memory'
export const MEMORY_PAGE_DESCRIPTION =
  'Notes the agent keeps across conversations. Global memories apply everywhere, group memories to every project in a group, and project memories only in that repository.'
export const selectedMemoryNamesOf = ({
  selected,
  memories,
}: {
  selected: readonly string[]
  memories: readonly Pick<MemoryEntry, 'name'>[]
}): string[] => selected.filter((name) => memories.some((entry) => entry.name === name))

export const memorySelectionOf = ({
  selectedNames,
  name,
  selected,
}: {
  selectedNames: readonly string[]
  name: string
  selected: boolean
}): string[] =>
  selected
    ? [...selectedNames.filter((value) => value !== name), name]
    : selectedNames.filter((value) => value !== name)

export const memoryDeleteTitleOf = (count: number): string =>
  `Delete ${count} ${count === 1 ? 'memory' : 'memories'}?`

export const MEMORY_DELETE_TAIL =
  'The agent stops seeing this memory in new threads. This cannot be undone.'

const MEMORY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

export const formatMemoryDate = (updatedAt: string): string =>
  MEMORY_DATE_FORMAT.format(new Date(updatedAt))

export const memoryGroupLabel = (group: MemoryScopeGroup): string => {
  if (group.scope === EMemoryScope.Group) return group.name ?? group.groupId ?? 'Group'
  return group.project ?? 'Global'
}

export const isMemoryTypeFilter = (value: string): value is EMemoryType | typeof MEMORY_ALL_TYPES =>
  MEMORY_TYPE_FILTERS.includes(value)

export const memoryMatchesFilter = ({
  entry,
  query,
  type,
}: {
  entry: MemoryEntry
  query: string
  type: string
}): boolean => {
  const needle = query.trim().toLowerCase()
  const searched =
    needle.length === 0 ||
    entry.name.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.body.toLowerCase().includes(needle)
  return searched && (type === MEMORY_ALL_TYPES || entry.type === type)
}

export const memoryScopeHintOf = (group: MemoryScopeGroup): string => {
  if (group.scope === EMemoryScope.Global) return 'Loaded in every thread, on every project.'
  if (group.scope === EMemoryScope.Group) {
    return `Loaded alongside global memories in threads on every project in the ${memoryGroupLabel(group)} group.`
  }
  return `Loaded alongside global and group memories in threads on ${group.project}.`
}

export const memoryClearDescriptionOf = (group: MemoryScopeGroup): string => {
  if (group.scope === EMemoryScope.Global) {
    return 'Deletes every global memory. Group and project memories are not touched.'
  }
  if (group.scope === EMemoryScope.Group) {
    return `Deletes every memory of the ${memoryGroupLabel(group)} group. Global memories and other scopes are not touched.`
  }
  return `Deletes every memory for ${group.project}. Global and group memories are not touched.`
}

export const memoryScopeOptionsOf = (
  groups: readonly MemoryScopeGroup[],
): { value: string; label: string }[] =>
  groups.map((group) => ({
    value: group.id,
    label: `${memoryGroupLabel(group)} (${group.memories.length})`,
  }))

export const memoryKeyInput = (key: MemoryKey) => ({
  scope: key.scope,
  name: key.name,
  ...(key.project === null ? {} : { project: key.project }),
  ...(key.groupId === null ? {} : { groupId: key.groupId }),
})

export const memoryKeyOf = ({
  group,
  name,
}: {
  group: MemoryScopeGroup
  name: string
}): MemoryKey => ({
  scope: group.scope,
  project: group.project,
  groupId: group.groupId,
  name,
})

export const summaryToEntry = (summary: MemorySummary): MemoryEntry => ({
  name: summary.name,
  description: summary.description,
  type: summary.type,
  body: '',
  revision: summary.revision,
  updatedAt: summary.updatedAt,
})

export const buildMemoryGroups = ({
  memories,
  groupNames,
}: {
  memories: readonly MemorySummary[]
  groupNames: ReadonlyMap<string, string>
}): MemoryScopeGroup[] => {
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
  for (const memory of memories) {
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
          name: groupNames.get(memory.groupId) ?? null,
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
