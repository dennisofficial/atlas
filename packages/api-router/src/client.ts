import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from '@trpc/client'
import type { AppRouter } from './generated/server'

export type ApiClientOptions = {
  baseUrl: string
  token?: string | undefined
  clientVersion?: string | undefined
  fetchFn?: typeof fetch | undefined
}

const trpcUrlOf = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/v1/trpc`

const headersOf = ({ token, clientVersion }: ApiClientOptions): Record<string, string> => ({
  ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  ...(clientVersion === undefined ? {} : { 'atlas-client-version': clientVersion }),
})

export const createApiClient = (options: ApiClientOptions) => {
  const url = trpcUrlOf(options.baseUrl)
  const fetchFn = options.fetchFn ?? fetch
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: httpSubscriptionLink({ url }),
        false: httpLink({
          url,
          fetch: async (input, init) => {
            const response = await fetchFn(input, {
              ...init,
              credentials: 'same-origin',
              signal: init?.signal ?? null,
            })
            return { ok: response.ok, json: () => response.json() }
          },
          headers: headersOf(options),
        }),
      }),
    ],
  })
}

export type ApiClient = ReturnType<typeof createApiClient>

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
