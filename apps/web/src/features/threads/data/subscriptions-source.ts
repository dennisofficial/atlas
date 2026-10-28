import { listSubscriptions } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import type { SubscriptionsWire } from '@dltech/atlas-wire/web'

export type SubscriptionsChannel = Pick<
  RemoteDeltaChannel,
  'request' | 'onSubscriptions' | 'onReload' | 'onReady'
>

export function watchSubscriptions(args: {
  channel: SubscriptionsChannel
  onSet: (set: SubscriptionsWire) => void
  onUnsupported: () => void
}): () => void {
  const { channel, onSet, onUnsupported } = args
  let active = true

  const refresh = (): void => {
    void listSubscriptions({ channel })
      .then((listed) => {
        if (!active) return
        if (listed === null) onUnsupported()
        else onSet(listed)
      })
      .catch(() => undefined)
  }

  const offs = [
    channel.onSubscriptions((pushed) => {
      if (active) onSet(pushed)
    }),
    channel.onReload(refresh),
    channel.onReady(refresh),
  ]
  refresh()

  return () => {
    active = false
    for (const off of offs) off()
  }
}
