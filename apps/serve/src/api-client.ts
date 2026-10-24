import type { AppRouter } from '@dltech/atlas-api-router'
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client'

export type ApiRemote = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}

export const createApiClient = (remote: ApiRemote) =>
  createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${remote.controlPlaneUrl.replace(/\/+$/, '')}/v1/trpc`,
        fetch: async (input, init) => {
          const response = await remote.fetchFn(
            input,
            init === undefined ? undefined : { ...init, signal: init.signal ?? null },
          )
          return { ok: response.ok, json: () => response.json() }
        },
        headers: {
          authorization: `Bearer ${remote.token}`,
          'atlas-client-version': remote.clientVersion,
        },
      }),
    ],
  })

export const httpStatusOf = (failure: unknown): number | undefined =>
  failure instanceof TRPCClientError ? failure.data?.httpStatus : undefined

export const detailsOf = (failure: unknown): Record<string, unknown> | undefined => {
  if (!(failure instanceof TRPCClientError)) return undefined
  const details: unknown = failure.data?.details
  return typeof details === 'object' && details !== null
    ? Object.fromEntries(Object.entries(details))
    : undefined
}

export const controlPlaneError = (failure: unknown): Error => {
  const status = httpStatusOf(failure)
  if (status === undefined || !(failure instanceof Error)) {
    return failure instanceof Error ? failure : new Error(String(failure))
  }
  return new Error(`the control plane answered ${status}: ${failure.message}`)
}
