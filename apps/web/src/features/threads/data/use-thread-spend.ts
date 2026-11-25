'use client'

import { useEffect, useRef, useState } from 'react'

import type { SpendTally } from '@dltech/atlas-core'

import type { LiveChannel } from './live-channel'
import { watchSpend } from './thread-spend-source'

export function useThreadSpend(args: {
  threadId: string
  channel: LiveChannel | null
  working: boolean
}): SpendTally | null {
  const { threadId, channel, working } = args
  const [held, setHeld] = useState<{
    channel: LiveChannel | null
    threadId: string
    spend: SpendTally
  } | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (channel === null) return undefined
    const onSpend = (spend: SpendTally): void => setHeld({ channel, threadId, spend })
    const watch = watchSpend({ channel, threadId, onSpend })
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
