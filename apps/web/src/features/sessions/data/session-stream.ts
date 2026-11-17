import { sessionStreamTransport } from '@dltech/atlas-api-router'
import {
  browserSessionCache,
  createStreamConnection,
  systemStreamScheduler,
  type SessionCache,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

import { api } from '@/lib/api-client'
import { sharedQueryClient } from '@/lib/query-client'
import { SESSION_QUERY_KEY } from '@/lib/use-session-query'

import { sessionEventSchema, sessionEventTypes } from '../registered-plugins'

let connection: StreamConnection | undefined
let cache: SessionCache | undefined

export function sessionCache(): SessionCache {
  cache ??= browserSessionCache(sessionEventSchema)
  return cache
}

const handleSignedOut = (): void => {
  void sharedQueryClient().invalidateQueries({ queryKey: [SESSION_QUERY_KEY] })
}

export function sessionStream(): StreamConnection {
  if (connection !== undefined) return connection
  connection = createStreamConnection({
    transport: sessionStreamTransport({ client: api, handleUnauthorized: handleSignedOut }),
    scheduler: systemStreamScheduler,
    eventSchema: sessionEventSchema,
    knownEventTypes: sessionEventTypes,
  })
  connection.connect()
  return connection
}
