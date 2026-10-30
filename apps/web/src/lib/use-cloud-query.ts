'use client'

import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

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

type Boxed<TData> = { value: TData }

export function useCloudQuery<TData>(args: {
  key: string
  load: () => Promise<TData>
  retry?: number
}): CloudQuery<TData> {
  const { key, load, retry } = args
  const query = useQuery<Boxed<TData>, CloudApiError>({
    queryKey: [key],
    queryFn: async () => {
      try {
        return { value: await load() }
      } catch (error) {
        throw asCloudError(error)
      }
    },
    ...(retry === undefined ? {} : { retry }),
  })
  const { refetch } = query
  const reload = useCallback(() => void refetch(), [refetch])

  if (query.data !== undefined) {
    return { state: EQueryState.Ready, data: query.data.value, error: undefined, reload }
  }
  if (query.status === 'error') {
    return { state: EQueryState.Failed, data: undefined, error: query.error, reload }
  }
  return { state: EQueryState.Loading, data: undefined, error: undefined, reload }
}
