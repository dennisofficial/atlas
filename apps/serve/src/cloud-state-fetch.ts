import { CloudError, cloudCall } from '@dltech/atlas-harness'

import { createApiClient, httpStatusOf } from './api-client'
import type { CloudConfig } from './cloud-config'

const UNAUTHORIZED = 401
const RETRY_DELAY_MS = 2_000
const DEFAULT_RETRY_BUDGET_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 30

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export type CloudStateFetchArgs = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  projectId?: string | null | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  retryBudgetMs?: number | undefined
  now?: (() => number) | undefined
  maxAttempts?: number | undefined
}

export const fetchCloudState = async (args: CloudStateFetchArgs) => {
  const sleep = args.sleep ?? defaultSleep
  const retryBudgetMs = args.retryBudgetMs ?? DEFAULT_RETRY_BUDGET_MS
  const now = args.now ?? Date.now
  const maxAttempts = args.maxAttempts ?? MAX_ATTEMPTS
  const url = args.controlPlaneUrl.replace(/\/+$/, '')

  const deadline = now() + retryBudgetMs

  const remainingMs = (): number => {
    const left = deadline - now()
    if (left <= 0) throw new Error(`Atlas Cloud state did not arrive within ${retryBudgetMs} ms`)
    return left
  }

  const isRegistering = (error: unknown): boolean =>
    (error instanceof CloudError && error.status === UNAUTHORIZED) ||
    httpStatusOf(error) === UNAUTHORIZED

  const patiently = async <T>(attempt: () => Promise<T>): Promise<T> => {
    for (let attempts = 1; ; attempts += 1) {
      try {
        return await attempt()
      } catch (error) {
        if (!isRegistering(error) || attempts >= maxAttempts || remainingMs() <= RETRY_DELAY_MS) {
          throw error
        }
        await sleep(RETRY_DELAY_MS)
      }
    }
  }

  const api = createApiClient({
    controlPlaneUrl: url,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  })

  const attemptSignal = () => AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs()))

  const leasePatiently = () =>
    patiently(() => api.accountLease.get.query(undefined, { signal: attemptSignal() }))

  const scopedConfig = async (): Promise<CloudConfig> => {
    const input = args.projectId ? { projectId: args.projectId } : undefined
    const resolved = await patiently(() =>
      cloudCall(api.sandboxConfig.get.query(input, { signal: attemptSignal() })),
    )
    return {
      settings: Object.entries(resolved.settings).map(([key, value]) => ({ key, value })),
      secrets: resolved.secrets,
      harnessSecrets: resolved.harnessSecrets,
      mcpServers: resolved.mcpServers,
      fileMounts: resolved.fileMounts,
    }
  }

  const [lease, config] = await Promise.all([leasePatiently(), scopedConfig()])
  return { lease, config }
}

export type CloudStateFetched = Awaited<ReturnType<typeof fetchCloudState>>

export const startCloudStateFetch = (args: CloudStateFetchArgs): Promise<CloudStateFetched> => {
  const started = fetchCloudState(args)
  started.catch(() => undefined)
  return started
}
