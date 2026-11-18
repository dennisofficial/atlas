import { sessionStreamTransport } from '@dltech/atlas-api-router'
import {
  createStreamConnection,
  systemStreamScheduler,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

import { v2EventSchema, v2EventTypes } from './registered-plugins'
import { getStreamClient } from './stream-token'

export { clearSessionLog, sessionLog } from './session-cache'

let connection: StreamConnection | undefined

export const sessionStream = (): StreamConnection => {
  connection ??= createStreamConnection({
    transport: {
      follow: (input, handlers) =>
        sessionStreamTransport({ client: getStreamClient() }).follow(input, handlers),
      list: (handlers) => sessionStreamTransport({ client: getStreamClient() }).list(handlers),
    },
    scheduler: systemStreamScheduler,
    networkSignal: () => () => {},
    eventSchema: v2EventSchema,
    knownEventTypes: v2EventTypes,
  })
  connection.connect()
  return connection
}
