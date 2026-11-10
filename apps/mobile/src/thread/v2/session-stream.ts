import {
  browserStreamSocket,
  createStreamConnection,
  systemStreamScheduler,
  type StreamConnection,
} from '@dltech/atlas-client/stream'
import { EStreamSurface } from '@dltech/atlas-protocol'

import { streamUrl } from '../../config'
import { v2EventSchema, v2EventTypes } from './registered-plugins'
import { getStreamToken } from './stream-token'

export { clearSessionCache, sessionCache } from './session-cache'

let connection: StreamConnection | undefined

export const sessionStream = (): StreamConnection => {
  connection ??= createStreamConnection({
    url: streamUrl,
    surface: EStreamSurface.Ios,
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
