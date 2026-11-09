import { renderMemoryIndex, type MemoryIndexLine } from '@dltech/atlas-core'
import { EMemoryScope, type MemorySummary } from '@dltech/atlas-wire'

export const UNAVAILABLE_PREFIX = 'Memory is unavailable this session'

export const memoryPromptOf = (text: string): string => `${UNAVAILABLE_PREFIX}: ${text}.`

export const unavailableIndexOf = (reason: string): string =>
  memoryPromptOf(reason.replace(/\.+$/, ''))

const linesOf = (
  summaries: readonly MemorySummary[],
  scope: EMemoryScope,
): readonly MemoryIndexLine[] =>
  summaries
    .filter((summary) => summary.scope === scope)
    .map((summary) => ({ name: summary.name, description: summary.description }))

export const memoryIndexOf = (args: {
  project: string | null
  memories: readonly MemorySummary[]
}): string =>
  renderMemoryIndex({
    global: linesOf(args.memories, EMemoryScope.Global),
    project:
      args.project === null
        ? null
        : { key: args.project, entries: linesOf(args.memories, EMemoryScope.Project) },
  })

export const memoryCoreSlots = {
  events: [] as readonly never[],
  views: [] as readonly never[],
  commands: [] as readonly never[],
} as const
