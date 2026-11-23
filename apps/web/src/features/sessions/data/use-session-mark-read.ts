'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { V2_SESSIONS_KEY } from '@/lib/cloud-keys'
import { closeSessionNotifications } from '@/lib/web-push'
import { usePageVisible } from '@/lib/use-page-visible'
import {
  createMarkReadScheduler,
  type MarkReadScheduler,
} from '@/features/threads/data/mark-read-scheduler'

import { markV2SessionRead } from './sessions-api'
import type { V2SessionSummary } from '@/features/shell/v2-rows'

export function useSessionMarkRead(args: { sessionId: string; head: number | undefined }) {
  const { sessionId, head } = args
  const queryClient = useQueryClient()
  const visible = usePageVisible()
  const scheduler = useRef<MarkReadScheduler | undefined>(undefined)

  useEffect(() => {
    void closeSessionNotifications(sessionId).catch(() => undefined)
  }, [sessionId])

  useEffect(() => {
    if (!visible) return undefined
    const created = createMarkReadScheduler({
      send: async (seq) => {
        const { readSeq } = await markV2SessionRead({ sessionId, seq })
        queryClient.setQueryData(
          [V2_SESSIONS_KEY],
          (rows: readonly V2SessionSummary[] | undefined) =>
            rows?.map((row) => (row.sessionId === sessionId ? { ...row, readSeq } : row)),
        )
      },
    })
    scheduler.current = created
    return () => {
      created.stop()
      scheduler.current = undefined
    }
  }, [sessionId, visible, queryClient])

  useEffect(() => {
    if (head !== undefined) scheduler.current?.push(head)
  }, [head])
}
