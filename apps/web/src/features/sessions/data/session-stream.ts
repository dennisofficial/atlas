import {
  browserStreamSocket,
  createStreamConnection,
  systemStreamScheduler,
  type SessionCache,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

import { browserSessionCache } from './indexed-db-session-cache'
import { fetchStreamToken } from './stream-token'

let connection: StreamConnection | undefined
let cache: SessionCache | undefined

export function sessionCache(): SessionCache {
  cache ??= browserSessionCache()
  return cache
}

export function sessionStream(): StreamConnection {
  if (connection !== undefined) return connection
  connection = createStreamConnection({
    url: process.env.ATLAS_STREAM_URL ?? '',
    getToken: fetchStreamToken,
    socket: browserStreamSocket,
    scheduler: systemStreamScheduler,
  })
  connection.connect()
  return connection
}
