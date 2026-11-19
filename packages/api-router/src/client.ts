import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from '@trpc/client'
import type { AppRouter } from './generated/server'

type SubscriptionEventSource = NonNullable<
  Parameters<typeof httpSubscriptionLink>[0]['EventSource']
>

type StreamFetchInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

export type ApiCredentials = 'omit' | 'same-origin' | 'include'

export type ApiClientOptions = {
  baseUrl: string
  token?: string | undefined
  clientVersion?: string | undefined
  credentials?: ApiCredentials | undefined
  fetchFn?: typeof fetch | undefined
  EventSource?: SubscriptionEventSource | undefined
}

const trpcUrlOf = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/v1/trpc`

const BASE64_CHUNK_BYTES = 0x8000

const base64OfUtf8 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

// Render's edge WAF blocks request bodies by content (shell commands, paths), so the JSON body
// travels base64-wrapped and the API unwraps it before tRPC parses it.
const encodeBody = (init: RequestInit): RequestInit => {
  const body = init.body
  return typeof body === 'string'
    ? { ...init, body: JSON.stringify({ atlasB64: base64OfUtf8(body) }) }
    : init
}

const credentialsOf = (options: ApiClientOptions): ApiCredentials =>
  options.credentials ?? 'same-origin'

const headersOf = ({ token, clientVersion }: ApiClientOptions): Record<string, string> => ({
  ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  ...(clientVersion === undefined ? {} : { 'atlas-client-version': clientVersion }),
})

export const createApiClient = (options: ApiClientOptions) => {
  const url = trpcUrlOf(options.baseUrl)
  const fetchFn = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    (options.fetchFn ?? globalThis.fetch)(input, init)
  const credentials = credentialsOf(options)
  const subscriptionLink =
    options.EventSource === undefined
      ? httpSubscriptionLink({
          url,
          ...(credentials === 'include' ? { eventSourceOptions: { withCredentials: true } } : {}),
        })
      : httpSubscriptionLink({
          url,
          EventSource: options.EventSource,
          eventSourceOptions: () => ({
            credentials,
            headers: headersOf(options),
            fetch: (target: string | URL, init?: StreamFetchInit) =>
              fetchFn(target, {
                credentials,
                ...init,
                headers: { ...init?.headers, ...headersOf(options) },
              }),
          }),
        })
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: subscriptionLink,
        false: httpLink({
          url,
          fetch: async (input, init) => {
            const response = await fetchFn(
              input,
              encodeBody({
                ...init,
                credentials,
                signal: init?.signal ?? null,
              }),
            )
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
