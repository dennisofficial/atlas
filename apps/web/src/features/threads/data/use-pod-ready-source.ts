'use client'

import { useEffect, useMemo, useState } from 'react'

import type { FileSource } from './file-source'
import { retryPodNotReady, type PodRetryNotice } from './pod-not-ready-retry'

export const retryingSource = (args: {
  source: FileSource
  signal: AbortSignal
  onWaiting: (notice: PodRetryNotice) => void
}): FileSource => ({
  browse: (input) =>
    retryPodNotReady({
      work: () => args.source.browse(input),
      signal: args.signal,
      onWaiting: args.onWaiting,
    }),
  search: (input) =>
    retryPodNotReady({
      work: () => args.source.search(input),
      signal: args.signal,
      onWaiting: args.onWaiting,
    }),
  read: (input) =>
    retryPodNotReady({
      work: () => args.source.read(input),
      signal: args.signal,
      onWaiting: args.onWaiting,
    }),
})

export function usePodReadySource(args: { source: FileSource | null }): {
  source: FileSource | null
  waking: boolean
} {
  const { source } = args
  const [waking, setWaking] = useState(false)
  const controller = useMemo(() => new AbortController(), [source])
  const wrapped = useMemo(
    () =>
      source === null
        ? null
        : retryingSource({
            source,
            signal: controller.signal,
            onWaiting: () => setWaking(true),
          }),
    [source, controller],
  )

  useEffect(() => {
    setWaking(false)
    return () => controller.abort()
  }, [controller])

  return { source: wrapped, waking }
}
