import { createApiClient } from '@dltech/atlas-api-router'
import type { PodLeaseRegistrar } from '@dltech/atlas-harness'
import { SESSION_COOKIE } from '../guard'

const withoutDesktopSecret = (cookie: string | null): string | null => {
  if (cookie === null) return null
  const kept = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(`${SESSION_COOKIE}=`))
  return kept.length === 0 ? null : kept.join('; ')
}

export function leaseRegistrarFor({
  apiOrigin,
  cookie,
  clientVersion,
  fetchFn,
}: {
  apiOrigin: string
  cookie: string | null
  clientVersion?: string
  fetchFn?: typeof fetch
}): PodLeaseRegistrar {
  const upstream = fetchFn ?? fetch
  const forwarded = withoutDesktopSecret(cookie)
  const withCookie = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      if (forwarded !== null) headers.set('cookie', forwarded)
      return upstream(input, { ...init, headers })
    },
    { preconnect: fetch.preconnect },
  )
  const api = createApiClient({ baseUrl: apiOrigin, clientVersion, fetchFn: withCookie })
  return async ({ threadId, token }) => {
    await api.podLeases.register.mutate({ threadId, token })
  }
}
