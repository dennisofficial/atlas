'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { IN_APP_NOTICE_FIXTURES, type InAppNotice } from './fixtures/notifications'
import { scanNotices, staleNoticeIdsOf } from './notice-scan'
import { useWindowFocus } from './use-window-focus'

const OPEN_LABEL = 'Open'
const THREADS_PREFIX = '/threads/'

const openSessionIdOf = (pathname: string): string | null => {
  if (!pathname.startsWith(THREADS_PREFIX)) return null
  const segment = pathname.slice(THREADS_PREFIX.length).split('/')[0]
  return segment === undefined || segment.length === 0 ? null : segment
}

export function useInAppNotices(notices: readonly InAppNotice[] = IN_APP_NOTICE_FIXTURES): void {
  const pathname = usePathname()
  const router = useRouter()
  const focused = useWindowFocus()
  const shown = useRef<readonly string[]>([])
  const openSessionId = openSessionIdOf(pathname)

  useEffect(() => {
    const next = scanNotices({ notices, shown: shown.current, focused, openSessionId })
    if (next.length === 0) return
    shown.current = [...shown.current, ...next.map((notice) => notice.sessionId)]
    for (const notice of next) {
      toast(notice.title, {
        id: notice.sessionId,
        description: notice.body,
        action: {
          label: OPEN_LABEL,
          onClick: () => router.push(`${THREADS_PREFIX}${notice.sessionId}`),
        },
      })
    }
  }, [notices, focused, openSessionId, router])

  useEffect(() => {
    const stale = staleNoticeIdsOf({ shown: shown.current, notices, openSessionId })
    if (stale.length === 0) return
    for (const sessionId of stale) toast.dismiss(sessionId)
    shown.current = shown.current.filter((sessionId) => !stale.includes(sessionId))
  }, [notices, openSessionId])
}
