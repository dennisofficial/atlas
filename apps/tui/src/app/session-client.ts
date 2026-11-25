import { createApiClient, sessionStreamTransport } from '@dltech/atlas-api-router'
import {
  createStreamConnection,
  type StreamConnection,
  type StreamNetworkSignal,
  systemStreamScheduler,
} from '@dltech/atlas-client/stream'
import { EStreamSurface } from '@dltech/atlas-protocol'
import { EventSource } from 'eventsource'

import { authWatchingTransport } from './auth-transport'
import { eventSchema, eventTypes, views } from './registered-plugins'
import { sessionApiOf, type SessionApi } from './session-api'

export type AuthRefusal = 401 | 403

export type SessionClient = {
  apiUrl: string
  api: SessionApi
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
  const client = createApiClient({
    baseUrl: args.apiUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
    EventSource,
  })

  const transport = authWatchingTransport({
    transport: sessionStreamTransport({
      client,
      surface: EStreamSurface.Terminal,
      handleUnauthorized: () => args.onAuthLost(401),
    }),
    onAuthLost: args.onAuthLost,
  })

  const connection = createStreamConnection({
    transport,
    scheduler: systemStreamScheduler,
    networkSignal: NO_NETWORK_SIGNAL,
    eventSchema: eventSchema,
    knownEventTypes: eventTypes,
    views: views,
  })

  return {
    apiUrl: args.apiUrl,
    api: sessionApiOf({ api: client, onAuthLost: args.onAuthLost }),
    connection,
    close: () => connection.close(),
  }
}
