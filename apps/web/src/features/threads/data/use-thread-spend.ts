'use client'

import { useEffect, useRef, useState } from 'react'

import type { SpendTally } from '@dltech/atlas-core'

import type { ServeChannel } from './live-thread-view'
import { watchSpend } from './thread-spend-source'

export function useThreadSpend(args: {
  threadId: string
  channel: ServeChannel | null
  working: boolean
}): SpendTally | null {
  const { threadId, channel, working } = args
  const [held, setHeld] = useState<{
    channel: ServeChannel
    spend: SpendTally
  } | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (channel === null) {
      refreshRef.current = () => undefined
      return
    }
    const watch = watchSpend({
      channel,
      threadId,
      onSpend: (spend) => setHeld({ channel, spend }),
    })
    refreshRef.current = watch.refresh
    return watch.stop
  }, [channel, threadId])

  const wasWorking = useRef(working)
  useEffect(() => {
    const settled = wasWorking.current && !working
    wasWorking.current = working
    if (settled) refreshRef.current()
  }, [working])

  return held !== null && held.channel === channel ? held.spend : null
}
