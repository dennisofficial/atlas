import type { WireThread } from '@dltech/atlas-wire/web'

import type { ProjectThreads } from './thread-partition'

export type ArchiveOverrides = ReadonlyMap<string, string | null>

const isArchived = (thread: WireThread): boolean =>
  thread.archivedAt !== null && thread.archivedAt !== undefined

export function applyArchiveOverrides(args: {
  entries: readonly ProjectThreads[]
  overrides: ArchiveOverrides
}): ProjectThreads[] {
  const { entries, overrides } = args
  return entries.map(({ project, threads }) => ({
    project,
    threads: threads.map((thread) => {
      const archivedAt = overrides.get(thread.id)
      return archivedAt === undefined ? thread : { ...thread, archivedAt }
    }),
  }))
}

export function settleArchiveOverrides(args: {
  entries: readonly ProjectThreads[]
  overrides: ArchiveOverrides
}): ArchiveOverrides {
  const { entries, overrides } = args
  if (overrides.size === 0) return overrides
  const settled = new Map(overrides)
  for (const { threads } of entries) {
    for (const thread of threads) {
      const archivedAt = overrides.get(thread.id)
      if (archivedAt === undefined) continue
      if ((archivedAt !== null) === isArchived(thread)) settled.delete(thread.id)
    }
  }
  return settled.size === overrides.size ? overrides : settled
}
