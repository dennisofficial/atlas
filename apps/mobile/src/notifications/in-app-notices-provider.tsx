import { createSessionsFeed } from '@dltech/atlas-client/stream'
import type { AtlasNotification } from '@dltech/atlas-core'
import {
  type InAppRow,
  inAppNoticesOf,
  inAppRowOf,
  staleNoticeIdsOf,
} from '@dltech/atlas-notifications/client'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { router, usePathname } from 'expo-router'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/auth-provider'
import { dismissPresentedRead } from '../push/notification-handler'
import { sessionStream } from '../thread/v2/session-stream'
import { InAppBanner } from './in-app-banner'
import { openSessionOf } from './open-session-of'
import { useAppFocused } from './use-app-focused'

export const BANNER_MS = 5000

export const InAppNoticesProvider = ({ children }: { children: ReactNode }) => {
  const { api } = useAuth()
  const [live, setLive] = useState<readonly StreamSessionRow[] | undefined>(undefined)
  const [notice, setNotice] = useState<AtlasNotification | null>(null)
  const [shown, setShown] = useState<readonly AtlasNotification[]>([])
  const previous = useRef<ReadonlyMap<string, InAppRow> | null>(null)
  const pathname = usePathname()
  const focused = useAppFocused()
  const openSessionId = openSessionOf(pathname)

  useEffect(() => {
    if (api === undefined) return undefined
    return createSessionsFeed({
      follow: () => sessionStream(api).followSessions(),
      write: setLive,
    }).retain()
  }, [api])

  const rows = useMemo(() => (live ?? []).map(inAppRowOf), [live])
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.sessionId, row])), [rows])
  const readSeqs = useMemo(() => {
    const entries: [string, number][] = []
    for (const row of rows) {
      if (row.readSeq !== null) entries.push([row.sessionId, row.readSeq])
    }
    return new Map(entries)
  }, [rows])

  useEffect(() => {
    if (!focused) return
    void dismissPresentedRead(readSeqs).catch(() => undefined)
  }, [focused, readSeqs])

  useEffect(() => {
    const notices = inAppNoticesOf({
      previous: previous.current,
      next: rows,
      openSessionId,
      focused,
      enabled: () => true,
      now: new Date().toISOString(),
    })
    previous.current = rowMap
    if (notices.length === 0) return
    setShown((current) => [...current, ...notices])
    setNotice(notices.at(-1) ?? null)
  }, [rows, rowMap, openSessionId, focused])

  useEffect(() => {
    const stale = staleNoticeIdsOf({ notices: shown, rows: rowMap, openSessionId })
    if (stale.length === 0) return
    setShown((current) => current.filter((entry) => !stale.includes(entry.sessionId)))
    setNotice((current) =>
      current === null || !stale.includes(current.sessionId) ? current : null,
    )
  }, [shown, rowMap, openSessionId])

  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), BANNER_MS)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <>
      {children}
      {notice === null ? null : (
        <InAppBanner
          notice={notice}
          onOpen={() => {
            setNotice(null)
            router.push({ pathname: '/sessions/[id]', params: { id: notice.sessionId } })
          }}
          onDismiss={() => setNotice(null)}
        />
      )}
    </>
  )
}
