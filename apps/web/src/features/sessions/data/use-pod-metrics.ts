'use client'

import { useEffect, useState } from 'react'

import { podMetricsFrameSchema } from '@dltech/atlas-protocol'

import { api } from '@/lib/api-client'

import { type PodMetricsSample, seriesAfter } from './pod-metrics-series'

const NONE: readonly PodMetricsSample[] = []
const RESUBSCRIBE_MS = 2_000
const UNAVAILABLE_BACKOFF_MAX_MS = 30_000

export type PodMetricsState = {
  series: readonly PodMetricsSample[]
  unavailable: boolean
}

const IDLE: PodMetricsState = { series: NONE, unavailable: false }

export function usePodMetrics(args: { sessionId: string; enabled?: boolean }): PodMetricsState {
  const { sessionId } = args
  const enabled = args.enabled ?? true
  const [state, setState] = useState<PodMetricsState>(IDLE)
  useEffect(() => {
    setState(IDLE)
    if (!enabled) return
    let stopped = false
    let active: { unsubscribe: () => void } | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let backoffMs = RESUBSCRIBE_MS
    const close = (): void => {
      clearTimeout(retry)
      retry = undefined
      const previous = active
      active = undefined
      previous?.unsubscribe()
    }
    const resubscribe = (delayMs: number): void => {
      if (stopped) return
      close()
      retry = setTimeout(open, delayMs)
    }
    const open = (): void => {
      if (stopped) return
      const subscription = api.sessions.podMetrics.subscribe(
        { sessionId },
        {
          onData: (value: unknown) => {
            const frame = podMetricsFrameSchema.safeParse(value)
            if (!frame.success) return
            if (frame.data.type === 'unavailable') {
              setState((current) => ({ series: current.series, unavailable: true }))
              resubscribe(backoffMs)
              backoffMs = Math.min(backoffMs * 2, UNAVAILABLE_BACKOFF_MAX_MS)
              return
            }
            backoffMs = RESUBSCRIBE_MS
            setState((current) => ({
              series: seriesAfter({ series: current.series, frame: frame.data }),
              unavailable: false,
            }))
          },
          onError: () => resubscribe(RESUBSCRIBE_MS),
          onComplete: () => resubscribe(RESUBSCRIBE_MS),
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
  return enabled ? state : IDLE
}
