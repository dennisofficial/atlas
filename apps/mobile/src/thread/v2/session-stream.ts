import { sessionStreamTransport, type ApiClient } from '@dltech/atlas-api-router'
import {
  createStreamConnection,
  systemStreamScheduler,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

import { v2EventSchema, v2EventTypes } from './registered-plugins'

export { clearSessionLog, sessionLog } from './session-cache'

let held: { client: ApiClient; connection: StreamConnection } | undefined

export const sessionStream = (client: ApiClient): StreamConnection => {
  if (held?.client === client) {
    held.connection.connect()
    return held.connection
  }
  held?.connection.close()
  const connection = createStreamConnection({
    transport: sessionStreamTransport({ client }),
    scheduler: systemStreamScheduler,
    networkSignal: () => () => {},
    eventSchema: v2EventSchema,
    knownEventTypes: v2EventTypes,
  })
  held = { client, connection }
  connection.connect()
  return connection
}
