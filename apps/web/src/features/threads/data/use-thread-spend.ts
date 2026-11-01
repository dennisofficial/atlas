'use client'

import { useEffect, useRef, useState } from 'react'

import type { SpendTally } from '@dltech/atlas-core'

import type { ServeChannel } from './live-thread-view'
import { watchApiSpend, watchSpend } from './thread-spend-source'

export function useThreadSpend(args: {
  threadId: string
  channel: ServeChannel | null
  working: boolean
}): SpendTally | null {
  const { threadId, channel, working } = args
  const [held, setHeld] = useState<{
    channel: ServeChannel | null
    threadId: string
    spend: SpendTally
  } | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const onSpend = (spend: SpendTally): void => setHeld({ channel, threadId, spend })
    const watch =
      channel === null
        ? watchApiSpend({ threadId, onSpend })
        : watchSpend({ channel, threadId, onSpend })
    refreshRef.current = watch.refresh
    return () => {
      refreshRef.current = () => undefined
      watch.stop()
    }
  }, [channel, threadId])

  const wasWorking = useRef(working)
  useEffect(() => {
    const settled = wasWorking.current && !working
    wasWorking.current = working
    if (settled) refreshRef.current()
  }, [working])

  return held !== null && held.channel === channel && held.threadId === threadId ? held.spend : null
}
