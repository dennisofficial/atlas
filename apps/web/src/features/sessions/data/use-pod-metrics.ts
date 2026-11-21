'use client'

import { useEffect, useState } from 'react'

import { podMetricsFrameSchema } from '@dltech/atlas-protocol'

import { api } from '@/lib/api-client'

import { type PodMetricsSample, seriesAfter } from './pod-metrics-series'

const NONE: readonly PodMetricsSample[] = []
const RESUBSCRIBE_MS = 2_000

export function usePodMetrics(args: {
  sessionId: string
  enabled?: boolean
}): readonly PodMetricsSample[] {
  const { sessionId } = args
  const enabled = args.enabled ?? true
  const [series, setSeries] = useState<readonly PodMetricsSample[]>(NONE)
  useEffect(() => {
    setSeries(NONE)
    if (!enabled) return
    let stopped = false
    let active: { unsubscribe: () => void } | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    const close = (): void => {
      clearTimeout(retry)
      retry = undefined
      const previous = active
      active = undefined
      previous?.unsubscribe()
    }
    const open = (): void => {
      if (stopped) return
      const subscription = api.sessions.podMetrics.subscribe(
        { sessionId },
        {
          onData: (value: unknown) => {
            const frame = podMetricsFrameSchema.safeParse(value)
            if (!frame.success) return
            setSeries((current) => seriesAfter({ series: current, frame: frame.data }))
          },
          onError: () => undefined,
          onComplete: () => {
            if (stopped) return
            close()
            retry = setTimeout(open, RESUBSCRIBE_MS)
          },
        },
      )
      if (stopped) subscription.unsubscribe()
      else active = subscription
    }
    open()
    return () => {
      stopped = true
      close()
    }
  }, [enabled, sessionId])
  return enabled ? series : NONE
}
