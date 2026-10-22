'use client'

import { useCallback, useEffect, useState } from 'react'

import { CloudApiError } from './cloud-api'

export enum EQueryState {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export type CloudQuery<TData> =
  | { state: EQueryState.Loading; data: undefined; error: undefined; reload: () => void }
  | { state: EQueryState.Ready; data: TData; error: undefined; reload: () => void }
  | { state: EQueryState.Failed; data: undefined; error: CloudApiError; reload: () => void }

const asCloudError = (error: unknown): CloudApiError =>
  error instanceof CloudApiError
    ? error
    : new CloudApiError({
        message: error instanceof Error ? error.message : String(error),
        status: 0,
      })

export function useCloudQuery<TData>(args: {
  key: string
  load: () => Promise<TData>
}): CloudQuery<TData> {
  const { key, load } = args
  const [generation, setGeneration] = useState(0)
  const [result, setResult] = useState<
    { key: string; data: TData } | { key: string; error: CloudApiError } | null
  >(null)

  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setResult({ key, data })
      },
      (error: unknown) => {
        if (!cancelled) setResult({ key, error: asCloudError(error) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [key, generation, load])

  const reload = useCallback(() => setGeneration((current) => current + 1), [])

  if (result === null || result.key !== key) {
    return { state: EQueryState.Loading, data: undefined, error: undefined, reload }
  }
  if ('error' in result) {
    return { state: EQueryState.Failed, data: undefined, error: result.error, reload }
  }
  return { state: EQueryState.Ready, data: result.data, error: undefined, reload }
}
