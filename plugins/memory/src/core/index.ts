import { renderMemoryIndex, type MemoryIndexLine } from '@dltech/atlas-core'
import type { MemoryScope, MemorySummary } from '@dltech/atlas-plugin-sdk'

export const UNAVAILABLE_PREFIX = 'Memory is unavailable this session'

export const memoryPromptOf = (text: string): string => `${UNAVAILABLE_PREFIX}: ${text}.`

export const unavailableIndexOf = (reason: string): string =>
  memoryPromptOf(reason.replace(/\.+$/, ''))

const linesOf = (
  summaries: readonly MemorySummary[],
  scope: MemoryScope,
): readonly MemoryIndexLine[] =>
  summaries
    .filter((summary) => summary.scope === scope)
    .map((summary) => ({ name: summary.name, description: summary.description }))

export const memoryIndexOf = (args: {
  project: string | null
  memories: readonly MemorySummary[]
}): string =>
  renderMemoryIndex({
    global: linesOf(args.memories, 'global'),
    project:
      args.project === null
        ? null
        : { key: args.project, entries: linesOf(args.memories, 'project') },
  })

export const memoryCoreSlots = {
  events: [] as readonly never[],
  views: [] as readonly never[],
  commands: [] as readonly never[],
} as const
