import type { SessionArchiveState } from '@dltech/atlas-client/stream'

export type ArchivableSession = {
  sessionId: string
  archivedAt: string | null | undefined
}

const archivedOf = (archivedAt: string | null | undefined): boolean =>
  archivedAt !== null && archivedAt !== undefined

export const archiveStatesOf = (
  sessions: readonly ArchivableSession[],
): readonly SessionArchiveState[] =>
  sessions.map((session) => ({
    sessionId: session.sessionId,
    archived: archivedOf(session.archivedAt),
  }))
