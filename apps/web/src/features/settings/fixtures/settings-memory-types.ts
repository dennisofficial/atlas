import { EMemoryScope, EMemoryType } from '@dltech/atlas-wire/web'

export { EMemoryScope, EMemoryType }

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
  memories: MemoryEntry[]
}

export const MEMORY_MAX_DESCRIPTION_CHARS = 300
export const MEMORY_MAX_BODY_CHARS = 20_000
export const MEMORY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/

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

export const MEMORY_GLOBAL_GROUP_ID = 'global'
