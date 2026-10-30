import { QueryClient } from '@tanstack/react-query'

import { CloudApiError } from './cloud-api'

export const STALE_TIME_MS = 30_000
export const RETRY_LIMIT = 1

const isClientError = (status: number) => status >= 400 && status < 500

export const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= RETRY_LIMIT) return false
  return !(error instanceof CloudApiError && isClientError(error.status))
}

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
    },
  })

let browserClient: QueryClient | undefined

export const sharedQueryClient = (): QueryClient => {
  if (typeof window === 'undefined') return createQueryClient()
  browserClient ??= createQueryClient()
  return browserClient
}

export const clearCloudCache = (): void => {
  browserClient?.clear()
}
