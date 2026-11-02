import type { WireThread } from '@dltech/atlas-wire/web'

import type { SessionNode } from '@/features/threads/data/threads-api'

import type { ProjectThreads } from './thread-partition'

export type ArchiveOverrides = ReadonlyMap<string, string | null>

const isArchived = (thread: WireThread): boolean =>
  thread.archivedAt !== null && thread.archivedAt !== undefined

const overriddenSession = (args: {
  session: SessionNode
  overrides: ArchiveOverrides
}): SessionNode => {
  const { session, overrides } = args
  const archivedAt = overrides.get(session.mainThread.id)
  return {
    ...session,
    mainThread:
      archivedAt === undefined ? session.mainThread : { ...session.mainThread, archivedAt },
    teammates: session.teammates.map((teammate) =>
      overriddenSession({ session: teammate, overrides }),
    ),
  }
}

export function applyArchiveOverrides(args: {
  entries: readonly ProjectThreads[]
  overrides: ArchiveOverrides
}): ProjectThreads[] {
  const { entries, overrides } = args
  return entries.map(({ project, sessions }) => ({
    project,
    sessions: sessions.map((session) => overriddenSession({ session, overrides })),
  }))
}

export function settleArchiveOverrides(args: {
  entries: readonly ProjectThreads[]
  overrides: ArchiveOverrides
}): ArchiveOverrides {
  const { entries, overrides } = args
  if (overrides.size === 0) return overrides
  const settled = new Map(overrides)
  const visit = (sessions: readonly SessionNode[]) => {
    for (const session of sessions) {
      const archivedAt = overrides.get(session.mainThread.id)
      if (archivedAt !== undefined && (archivedAt !== null) === isArchived(session.mainThread)) {
        settled.delete(session.mainThread.id)
      }
      visit(session.teammates)
    }
  }
  for (const { sessions } of entries) visit(sessions)
  return settled.size === overrides.size ? overrides : settled
}
