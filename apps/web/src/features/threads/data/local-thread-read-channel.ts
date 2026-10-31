import { EConnectionView } from '@dltech/atlas-client/channel'

import type { ServeChannel } from './live-thread-view'

export function localThreadReadChannel(args: {
  channel: ServeChannel
  available: () => boolean
}): ServeChannel {
  const { channel } = args
  return {
    ...channel,
    request: (request) => {
      if (!args.available() || channel.connection().state !== EConnectionView.Connected) {
        return Promise.reject(new Error('the sandbox is not connected'))
      }
      return channel.request(request)
    },
  }
}
