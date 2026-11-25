export type TArchiveOverrides = ReadonlyMap<string, string | null>

export type ArchivableSummary = {
  sessionId: string
  archivedAt: string | null
}

export const NO_ARCHIVE_OVERRIDES: TArchiveOverrides = new Map()

export const withArchiveOverride = ({
  overrides,
  sessionId,
  archivedAt,
}: {
  overrides: TArchiveOverrides
  sessionId: string
  archivedAt: string | null | undefined
}): TArchiveOverrides => {
  const next = new Map(overrides)
  if (archivedAt === undefined) next.delete(sessionId)
  else next.set(sessionId, archivedAt)
  return next
}

export const applyArchiveOverrides = <TSummary extends ArchivableSummary>({
  sessions,
  overrides,
}: {
  sessions: readonly TSummary[]
  overrides: TArchiveOverrides
}): readonly TSummary[] => {
  if (overrides.size === 0) return sessions
  return sessions.map((session) => {
    const archivedAt = overrides.get(session.sessionId)
    if (archivedAt === undefined) return session
    return { ...session, archivedAt }
  })
}

export const settledArchiveOverrides = <TSummary extends ArchivableSummary>({
  overrides,
  sessions,
}: {
  overrides: TArchiveOverrides
  sessions: readonly TSummary[]
}): TArchiveOverrides => {
  if (overrides.size === 0) return overrides
  const stored = new Map(sessions.map((session) => [session.sessionId, session.archivedAt]))
  const next = new Map(overrides)
  for (const [sessionId, archivedAt] of next) {
    const current = stored.get(sessionId)
    if (current === undefined) continue
    if ((current !== null) === (archivedAt !== null)) next.delete(sessionId)
  }
  return next.size === overrides.size ? overrides : next
}
