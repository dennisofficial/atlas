'use client'

import { type AtlasNotification, notifySettingsOf } from '@dltech/atlas-core'
import {
  type InAppRow,
  inAppNoticesOf,
  inAppRowOf,
  staleNoticeIdsOf,
} from '@dltech/atlas-notifications/client'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

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
  const rows = useMemo(() => (query.data ?? []).map(inAppRowOf), [query.data])
  const openSessionId = activeSessionIdOf(pathname)
  const rowMap = useMemo(() => new Map(rows.map((row) => [row.sessionId, row])), [rows])

  useEffect(() => {
    const notices = inAppNoticesOf({
      previous: previous.current,
      next: rows,
      openSessionId,
      focused,
      enabled: (moment) => notifySettings.enabled(moment),
      now: new Date().toISOString(),
    })
    previous.current = rowMap
    if (notices.length === 0) return
    for (const notice of notices) {
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
  }, [rows, rowMap, openSessionId, focused, router, notifySettings])

  useEffect(() => {
    const stale = staleNoticeIdsOf({ notices: shown.current, rows: rowMap, openSessionId })
    if (stale.length === 0) return
    for (const sessionId of stale) toast.dismiss(sessionId)
    shown.current = shown.current.filter((notice) => !stale.includes(notice.sessionId))
  }, [rowMap, openSessionId])
}
