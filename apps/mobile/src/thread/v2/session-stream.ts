import {
  browserStreamSocket,
  createStreamConnection,
  memorySessionCache,
  systemStreamScheduler,
  type SessionCache,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

import { streamUrl } from '../../config'
import { v2EventSchema, v2EventTypes } from './registered-plugins'
import { getStreamToken } from './stream-token'

let connection: StreamConnection | undefined
let cache: SessionCache | undefined

export const sessionCache = (): SessionCache => {
  cache ??= memorySessionCache()
  return cache
}

export const sessionStream = (): StreamConnection => {
  connection ??= createStreamConnection({
    url: streamUrl,
    getToken: getStreamToken,
    socket: browserStreamSocket,
    scheduler: systemStreamScheduler,
    networkSignal: () => () => {},
    eventSchema: v2EventSchema,
    knownEventTypes: v2EventTypes,
  })
  connection.connect()
  return connection
}
