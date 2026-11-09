import {
  browserSessionCache,
  browserStreamSocket,
  createStreamConnection,
  systemStreamScheduler,
  type SessionCache,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

import { AuthApiError } from '@/lib/auth-api'
import { sharedQueryClient } from '@/lib/query-client'
import { SESSION_QUERY_KEY } from '@/lib/use-session-query'

import { sessionEventSchema, sessionEventTypes } from '../registered-plugins'
import { fetchStreamToken, SIGNED_OUT_CODE } from './stream-token'

let connection: StreamConnection | undefined
let cache: SessionCache | undefined

export function sessionCache(): SessionCache {
  cache ??= browserSessionCache(sessionEventSchema)
  return cache
}

export const tokenSourceOf =
  ({ fetchToken, onSignedOut }: { fetchToken: () => Promise<string>; onSignedOut: () => void }) =>
  async (): Promise<string> => {
    try {
      return await fetchToken()
    } catch (failure) {
      if (failure instanceof AuthApiError && failure.code === SIGNED_OUT_CODE) onSignedOut()
      throw failure
    }
  }

const handleSignedOut = (): void => {
  void sharedQueryClient().invalidateQueries({ queryKey: [SESSION_QUERY_KEY] })
}

export function sessionStream(): StreamConnection {
  if (connection !== undefined) return connection
  connection = createStreamConnection({
    url: process.env.ATLAS_STREAM_URL ?? '',
    getToken: tokenSourceOf({ fetchToken: fetchStreamToken, onSignedOut: handleSignedOut }),
    socket: browserStreamSocket,
    scheduler: systemStreamScheduler,
    eventSchema: sessionEventSchema,
    knownEventTypes: sessionEventTypes,
  })
  connection.connect()
  return connection
}
