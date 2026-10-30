import { createApiClient } from '@dltech/atlas-api-router'
import type { PodLeaseRegistrar } from '@dltech/atlas-harness'

export function leaseRegistrarFor({
  apiOrigin,
  bearer,
  clientVersion,
  fetchFn,
}: {
  apiOrigin: string
  bearer: () => string | undefined
  clientVersion?: string
  fetchFn?: typeof fetch
}): PodLeaseRegistrar {
  const upstream = fetchFn ?? fetch
  const withBearer = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      headers.delete('cookie')
      headers.delete('origin')
      const token = bearer()
      if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
      return upstream(input, { ...init, headers })
    },
    { preconnect: fetch.preconnect },
  )
  const api = createApiClient({ baseUrl: apiOrigin, clientVersion, fetchFn: withBearer })
  return async ({ threadId, token }) => {
    await api.podLeases.register.mutate({ threadId, token })
  }
}
