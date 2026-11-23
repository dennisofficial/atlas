import { createApiClient, sessionStreamTransport } from '@dltech/atlas-api-router'
import {
  createStreamConnection,
  type StreamConnection,
  type StreamNetworkSignal,
  systemStreamScheduler,
} from '@dltech/atlas-client/stream'
import { EventSource } from 'eventsource'

import { authWatchingTransport } from './auth-transport'
import { v2EventSchema, v2EventTypes, v2Views } from './registered-plugins'

export type AuthRefusal = 401 | 403

export type SessionClient = {
  apiUrl: string
  connection: StreamConnection
  close: () => void
}

const NO_NETWORK_SIGNAL: StreamNetworkSignal = () => () => {}

export const createSessionClient = (args: {
  apiUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
  onAuthLost: (status: AuthRefusal) => void
}): SessionClient => {
  const api = createApiClient({
    baseUrl: args.apiUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
    EventSource,
  })

  const transport = authWatchingTransport({
    transport: sessionStreamTransport({
      client: api,
      handleUnauthorized: () => args.onAuthLost(401),
    }),
    onAuthLost: args.onAuthLost,
  })

  const connection = createStreamConnection({
    transport,
    scheduler: systemStreamScheduler,
    networkSignal: NO_NETWORK_SIGNAL,
    eventSchema: v2EventSchema,
    knownEventTypes: v2EventTypes,
    views: v2Views,
  })

  return { apiUrl: args.apiUrl, connection, close: () => connection.close() }
}
