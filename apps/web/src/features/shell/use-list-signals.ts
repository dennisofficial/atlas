'use client'

import { useEffect, useRef } from 'react'

import { subscribeListSignals } from '@/features/threads/data/threads-api'
import { usePageVisible } from '@/lib/use-page-visible'

import { activityOverrides } from './activity-overrides'
import { createListSignals } from './list-reload'

export function useListSignals(args: { reload: () => void }): void {
  const { reload } = args
  const visible = usePageVisible()
  const startedOnce = useRef(false)

  useEffect(() => {
    if (!visible) return undefined
    const signals = createListSignals({
      subscribe: subscribeListSignals,
      reload,
      onActivity: activityOverrides.record,
      resumed: startedOnce.current,
    })
    startedOnce.current = true
    signals.start()
    return signals.stop
  }, [visible, reload])
}
