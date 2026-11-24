import type { StreamSubscriptionHandlers, StreamTransport } from '@dltech/atlas-client/stream'

import { isRefusal } from './account/session-email'
import type { AuthRefusal } from './session-client'

export const authWatchingTransport = (args: {
  transport: StreamTransport
  onAuthLost: (status: AuthRefusal) => void
}): StreamTransport => {
  const watched = (handlers: StreamSubscriptionHandlers): StreamSubscriptionHandlers => ({
    handleFrame: (frame) => handlers.handleFrame(frame),
    handleEnd: () => handlers.handleEnd(),
    handleFailure: (status) => {
      if (isRefusal(status)) args.onAuthLost(status)
      handlers.handleFailure(status)
    },
  })

  const events = args.transport.events

  return {
    follow: (input, handlers) => args.transport.follow(input, watched(handlers)),
    list: (handlers) => args.transport.list(watched(handlers)),
    ...(events === undefined ? {} : { events }),
  }
}
