import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { rosterWireSchema, type RosterWire } from '@dltech/atlas-wire/web'

export type RosterChannel = Pick<RemoteDeltaChannel, 'request' | 'onRoster'>

export function subscribeRoster(args: {
  channel: RosterChannel
  onRoster: (roster: RosterWire) => void
}): () => void {
  let active = true
  const unsubscribe = args.channel.onRoster((roster) => {
    if (active) args.onRoster(roster)
  })
  void args.channel
    .request({ op: EClientRequest.ListRoster, params: {} })
    .then((reply) => {
      const parsed = rosterWireSchema.safeParse(reply)
      if (active && parsed.success) args.onRoster(parsed.data)
    })
    .catch(() => undefined)
  return () => {
    active = false
    unsubscribe()
  }
}
