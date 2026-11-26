export type SessionTitles = ReadonlyMap<string, string>

const sameTitles = (left: SessionTitles, right: SessionTitles): boolean => {
  if (left.size !== right.size) return false
  for (const [sessionId, title] of left) {
    if (right.get(sessionId) !== title) return false
  }
  return true
}

export const sessionTitlesOf = (args: {
  rows: readonly { sessionId: string; title?: string | null | undefined }[] | undefined
  previous: SessionTitles
}): SessionTitles => {
  const next = new Map<string, string>()
  for (const row of args.rows ?? []) {
    if (row.title !== undefined && row.title !== null) next.set(row.sessionId, row.title)
  }
  return sameTitles(args.previous, next) ? args.previous : next
}
