'use client'

import { type AtlasNotification, type ENotifyMoment, notifySettingsOf } from '@dltech/atlas-core'
import {
  dueDelayMs,
  earliestDueAt,
  type HeldNotice,
  type InAppRow,
  inAppRowOf,
  inAppScanOf,
  staleNoticeIdsOf,
} from '@dltech/atlas-notifications/client'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { reportInAppShown } from '@/features/sessions/data/notify-api'
import { fetchV2Sessions } from '@/features/sessions/data/sessions-api'
import { activeSessionIdOf } from '@/features/shell/active-route'
import { v2SessionHref } from '@/features/shell/v2-rows'
import { V2_SESSIONS_KEY } from '@/lib/cloud-keys'
import { useCloudSettings } from '@/lib/cloud-settings'

import { useWindowFocus } from './use-window-focus'

const OPEN_LABEL = 'Open'

export function useInAppNotices(): void {
  const query = useQuery({
    queryKey: [V2_SESSIONS_KEY],
    queryFn: fetchV2Sessions,
    staleTime: Infinity,
  })
  const pathname = usePathname()
  const router = useRouter()
  const focused = useWindowFocus()
  const settings = useCloudSettings()
  const settingsValues = settings.query.data
  const notifySettings = useMemo(
    () => notifySettingsOf({ values: settingsValues ?? new Map() }),
    [settingsValues],
  )
  const previous = useRef<ReadonlyMap<string, InAppRow> | null>(null)
  const shown = useRef<readonly AtlasNotification[]>([])
  const held = useRef<readonly HeldNotice[]>([])
  const [tick, setTick] = useState(0)
  const rows = useMemo(() => (query.data ?? []).map(inAppRowOf), [query.data])
  const openSessionId = activeSessionIdOf(pathname)
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.sessionId, row])), [rows])
  const enabled = useCallback(
    (moment: ENotifyMoment) => notifySettings.enabled(moment),
    [notifySettings],
  )

  const show = useCallback(
    (notices: readonly AtlasNotification[]) => {
      if (notices.length === 0) return
      for (const notice of notices) {
        void reportInAppShown(notice)
        toast(notice.title, {
          id: notice.sessionId,
          description: notice.body,
          action: {
            label: OPEN_LABEL,
            onClick: () => router.push(v2SessionHref(notice.sessionId)),
          },
        })
      }
      shown.current = [...shown.current, ...notices]
    },
    [router],
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
    show(scan.notices)
    const dueAt = earliestDueAt(scan.held)
    if (dueAt === null) return undefined
    const timer = setTimeout(
      () => setTick((current) => current + 1),
      dueDelayMs({ dueAt, nowMs: Date.now() }),
    )
    return () => clearTimeout(timer)
  }, [rows, rowMap, openSessionId, focused, enabled, show, tick])

  useEffect(() => {
    const stale = staleNoticeIdsOf({ notices: shown.current, rows: rowMap, openSessionId })
    if (stale.length === 0) return
    for (const sessionId of stale) toast.dismiss(sessionId)
    shown.current = shown.current.filter((notice) => !stale.includes(notice.sessionId))
  }, [rowMap, openSessionId])
}
