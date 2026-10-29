import type { WireThread } from '@dltech/atlas-wire/web'

import type { SessionNode } from '@/features/threads/data/threads-api'

import type { ProjectThreads } from './thread-partition'

export type ArchiveOverrides = ReadonlyMap<string, string | null>

const isArchived = (thread: WireThread): boolean =>
  thread.archivedAt !== null && thread.archivedAt !== undefined

export function applyArchiveOverrides(args: {
  entries: readonly ProjectThreads[]
  overrides: ArchiveOverrides
}): ProjectThreads[] {
  const { entries, overrides } = args
  return entries.map(({ project, sessions }) => ({
    project,
    sessions: sessions.map((session): SessionNode => {
      const archivedAt = overrides.get(session.mainThread.id)
      return archivedAt === undefined
        ? session
        : { ...session, mainThread: { ...session.mainThread, archivedAt } }
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
  for (const { sessions } of entries) {
    for (const { mainThread: thread } of sessions) {
      const archivedAt = overrides.get(thread.id)
      if (archivedAt === undefined) continue
      if ((archivedAt !== null) === isArchived(thread)) settled.delete(thread.id)
    }
  }
  return settled.size === overrides.size ? overrides : settled
}
