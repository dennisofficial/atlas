'use client'

import { useEffect, useEffectEvent, useState } from 'react'

export type Refetched<TData> = { data: TData | null; error: Error | null }

type Settled<TData> = { key: string; data: TData | null; error: Error | null }

const asError = (failure: unknown): Error =>
  failure instanceof Error ? failure : new Error(String(failure))

export function useRefetched<TData>(args: {
  key: string
  refreshKey: string
  enabled: boolean
  load: () => Promise<TData>
}): Refetched<TData> {
  const { key, refreshKey, enabled } = args
  const load = useEffectEvent(() => args.load())
  const [settled, setSettled] = useState<Settled<TData> | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setSettled({ key, data, error: null })
      },
      (failure: unknown) => {
        if (cancelled) return
        const error = asError(failure)
        setSettled((current) => ({
          key,
          data: current?.key === key ? current.data : null,
          error,
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [key, refreshKey, enabled])

  if (!enabled || settled === null || settled.key !== key) return { data: null, error: null }
  return { data: settled.data, error: settled.error }
}
