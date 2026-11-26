import { renderMemoryIndex, type MemoryIndexLine } from '@dltech/atlas-core'
import type { MemoryScope, MemorySummary } from '@dltech/atlas-plugin-sdk'

const byName = (left: MemorySummary, right: MemorySummary): number =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0

const linesOf = (
  summaries: readonly MemorySummary[],
  scope: MemoryScope,
): readonly MemoryIndexLine[] =>
  summaries
    .filter((summary) => summary.scope === scope)
    .sort(byName)
    .map((summary) => ({ name: summary.name, description: summary.description }))

export const memoryIndexOf = (args: {
  project: string | null
  group?: string | null
  memories: readonly MemorySummary[]
}): string => {
  const group = args.group ?? null
  return renderMemoryIndex({
    global: linesOf(args.memories, 'global'),
    group: group === null ? null : { key: group, entries: linesOf(args.memories, 'group') },
    project:
      args.project === null
        ? null
        : { key: args.project, entries: linesOf(args.memories, 'project') },
  })
}

export const memoryCoreSlots = {
  events: [] as readonly never[],
  views: [] as readonly never[],
  commands: [] as readonly never[],
} as const
