import {
  ATLAS_MEMORIES,
  COMP_MEMORIES,
  GLOBAL_MEMORIES,
  RS_CRM_MEMORIES,
} from './settings-memory-entries'
import {
  EMemoryScope,
  MEMORY_GLOBAL_GROUP_ID,
  MEMORY_RS_CRM_GROUP_ID,
  type MemoryScopeGroup,
} from './settings-memory-types'

export * from './settings-memory-types'

const MEMORY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatMemoryDate(updatedAt: string): string {
  return MEMORY_DATE_FORMAT.format(new Date(updatedAt))
}

export function memoryGroupLabel(group: MemoryScopeGroup): string {
  return group.project ?? 'Global'
}

export const MEMORY_SCOPE_GROUPS: MemoryScopeGroup[] = [
  {
    id: MEMORY_GLOBAL_GROUP_ID,
    scope: EMemoryScope.Global,
    project: null,
    memories: GLOBAL_MEMORIES,
  },
  {
    id: 'dennisofficial/atlas',
    scope: EMemoryScope.Project,
    project: 'dennisofficial/atlas',
    memories: ATLAS_MEMORIES,
  },
  {
    id: MEMORY_RS_CRM_GROUP_ID,
    scope: EMemoryScope.Project,
    project: MEMORY_RS_CRM_GROUP_ID,
    memories: RS_CRM_MEMORIES,
  },
  {
    id: 'trycompai/comp',
    scope: EMemoryScope.Project,
    project: 'trycompai/comp',
    memories: COMP_MEMORIES,
  },
]

export const EMPTY_MEMORY_GROUP: MemoryScopeGroup = {
  id: 'dennisofficial/ortho-v4',
  scope: EMemoryScope.Project,
  project: 'dennisofficial/ortho-v4',
  memories: [],
}
