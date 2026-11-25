import { createSessionsFeed } from '@dltech/atlas-client/stream'
import {
  type AtlasNotification,
  type ENotifyMoment,
  notifyEventSettingKey,
} from '@dltech/atlas-core'
import {
  dueDelayMs,
  earliestDueAt,
  type HeldNotice,
  type InAppRow,
  inAppRowOf,
  inAppScanOf,
  staleNoticeIdsOf,
} from '@dltech/atlas-notifications/client'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { usePathname } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

import { useAuth } from '../auth/auth-provider'
import { applyNavigation } from '../navigation/apply-navigation'
import { sessionOpenOf } from '../navigation/root-navigation'
import { useSettings } from '../settings/settings-provider'
import { dismissPresentedRead } from '../push/notification-handler'
import { reportInAppShown } from '../push/notification-track'
import { sessionStream } from '../thread/session/session-stream'
import { InAppBanner } from './in-app-banner'
import { openSessionOf } from './open-session-of'
import { useAppFocused } from './use-app-focused'

export const BANNER_MS = 5000

export const InAppNoticesProvider = ({ children }: { children: ReactNode }) => {
  const { api } = useAuth()
  const settings = useSettings()
  const [live, setLive] = useState<readonly StreamSessionRow[] | undefined>(undefined)
  const [notice, setNotice] = useState<AtlasNotification | null>(null)
  const [shown, setShown] = useState<readonly AtlasNotification[]>([])
  const previous = useRef<ReadonlyMap<string, InAppRow> | null>(null)
  const held = useRef<readonly HeldNotice[]>([])
  const [tick, setTick] = useState(0)
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

  const enabled = useCallback(
    (moment: ENotifyMoment) =>
      settings.read({ key: notifyEventSettingKey(moment), schema: z.boolean() }),
    [settings],
  )

  useEffect(() => {
    const scan = inAppScanOf({
      previous: previous.current,
      next: rows,
      held: held.current,
      openSessionId,
      focused,
      enabled,
      now: new Date().toISOString(),
    })
    previous.current = rowMap
    held.current = scan.held
    if (scan.notices.length > 0) {
      for (const notice of scan.notices) void reportInAppShown({ client: api, notice })
      setShown((current) => [...current, ...scan.notices])
      setNotice(scan.notices.at(-1) ?? null)
    }
    const dueAt = earliestDueAt(scan.held)
    if (dueAt === null) return undefined
    const timer = setTimeout(
      () => setTick((current) => current + 1),
      dueDelayMs({ dueAt, nowMs: Date.now() }),
    )
    return () => clearTimeout(timer)
  }, [rows, rowMap, openSessionId, focused, enabled, tick, api])

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
            applyNavigation(sessionOpenOf({ pathname, id: notice.sessionId }))
          }}
          onDismiss={() => setNotice(null)}
        />
      )}
    </>
  )
}
