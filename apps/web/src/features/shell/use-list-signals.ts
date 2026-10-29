'use client'

import { useEffect } from 'react'

import { subscribeListSignals } from '@/features/threads/data/threads-api'
import { usePageVisible } from '@/lib/use-page-visible'

import { createListSignals } from './list-reload'

export function useListSignals(args: { reload: () => void }): void {
  const { reload } = args
  const visible = usePageVisible()

  useEffect(() => {
    if (!visible) return undefined
    const signals = createListSignals({ subscribe: subscribeListSignals, reload })
    signals.start()
    return signals.stop
  }, [visible, reload])
}
