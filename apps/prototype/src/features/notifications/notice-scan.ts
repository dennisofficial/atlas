import type { InAppNotice } from './fixtures/notifications'

export function scanNotices({
  notices,
  shown,
  focused,
  openSessionId,
}: {
  notices: readonly InAppNotice[]
  shown: readonly string[]
  focused: boolean
  openSessionId: string | null
}): readonly InAppNotice[] {
  if (!focused) return []
  return notices.filter(
    (notice) => notice.sessionId !== openSessionId && !shown.includes(notice.sessionId),
  )
}

export function staleNoticeIdsOf({
  shown,
  notices,
  openSessionId,
}: {
  shown: readonly string[]
  notices: readonly InAppNotice[]
  openSessionId: string | null
}): readonly string[] {
  return shown.filter(
    (sessionId) =>
      sessionId === openSessionId || !notices.some((notice) => notice.sessionId === sessionId),
  )
}
