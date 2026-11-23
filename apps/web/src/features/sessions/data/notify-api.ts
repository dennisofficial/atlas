import { createApiClient } from '@dltech/atlas-api-router'
import type { ReportNotifyPresenceInput } from '@dltech/atlas-wire'

import { apiBaseUrl } from '@/lib/api-base-url'
import { api, cloudCall } from '@/lib/api-client'

const keepaliveFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, { ...init, keepalive: true }),
  { preconnect: globalThis.fetch.preconnect },
)

const awayApi = createApiClient({
  baseUrl: apiBaseUrl(),
  credentials: 'include',
  fetchFn: keepaliveFetch,
})

export const reportPresence = (input: ReportNotifyPresenceInput) =>
  cloudCall(api.notifications.reportPresence.mutate(input))

export const reportPresenceAway = (input: ReportNotifyPresenceInput) =>
  cloudCall(awayApi.notifications.reportPresence.mutate(input))
