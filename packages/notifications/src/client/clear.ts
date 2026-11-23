import type { AtlasNotification } from '@dltech/atlas-core'

export const staleNoticeIdsOf = (args: {
  notices: readonly AtlasNotification[]
  rows: ReadonlyMap<string, { sessionId: string; readSeq: number | null }>
  openSessionId: string | null
}): string[] =>
  args.notices.flatMap((notice) => {
    if (notice.sessionId === args.openSessionId) return [notice.sessionId]
    const row = args.rows.get(notice.sessionId)
    const readSeq = row?.readSeq ?? null
    return readSeq !== null && readSeq >= notice.seq ? [notice.sessionId] : []
  })
