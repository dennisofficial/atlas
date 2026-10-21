import type { MemoryScopeGroup } from './settings-memory-types'

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
