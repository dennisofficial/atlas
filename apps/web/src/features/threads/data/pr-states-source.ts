import { EClientRequest } from '@dltech/atlas-client/channel'
import type { RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { prStatesWireSchema, type PrStateWire } from '@dltech/atlas-wire/web'

export type PrStatesChannel = Pick<RemoteDeltaChannel, 'request' | 'onPrStates'>

export function subscribePrStates(args: {
  channel: PrStatesChannel
  onStates: (states: readonly PrStateWire[]) => void
}): () => void {
  let active = true
  const unsubscribe = args.channel.onPrStates((states) => {
    if (active) args.onStates(states)
  })
  void args.channel
    .request({ op: EClientRequest.ListPrStates, params: {} })
    .then((reply) => {
      const parsed = prStatesWireSchema.safeParse(reply)
      if (active && parsed.success) args.onStates(parsed.data.states)
    })
    .catch(() => undefined)
  return () => {
    active = false
    unsubscribe()
  }
}
