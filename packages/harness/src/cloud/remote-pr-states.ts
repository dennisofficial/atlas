import { prStatesWireSchema, type PrStateWire } from '@dltech/atlas-wire'

import { EClientRequest } from './channel-wire'
import { RemoteRequestFailed, RemoteRequestLost } from './remote-channel-upstream'

export const EMPTY_PR_STATES: readonly PrStateWire[] = Object.freeze([])

/**
 * The read shape a cloud-attached surface renders: the channel's answer to a list-pr-states request
 * on attach, then the pushed set from then on. A serve older than the op refuses the request, and a
 * socket drop can lose one in flight — both are an empty read, never an error: the surface falls
 * back to its local badge cache, and the next pushed set or onReady re-answer heals it.
 */
export type RemotePrStateReader = {
  states(): Promise<readonly PrStateWire[]>
  /** The last pushed set; empty until the first push lands. */
  current(): readonly PrStateWire[]
  onChange(listener: () => void): () => void
}

type PrStateChannel = {
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  onPrStates(listener: (states: readonly PrStateWire[]) => void): () => void
  onReload(listener: () => void): () => void
  onReady(listener: () => void): () => void
}

export function createRemotePrStateReader(args: { channel: PrStateChannel }): RemotePrStateReader {
  const { channel } = args
  const listeners = new Set<() => void>()
  let held: readonly PrStateWire[] = EMPTY_PR_STATES
  let unsubscribeChannel: (() => void) | null = null

  const poke = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const attach = (): void => {
    if (unsubscribeChannel !== null) return
    const offs = [
      channel.onPrStates((states) => {
        held = states
        poke()
      }),
      // A reload or a re-attach means the held set may be stale; re-answer it against the live serve.
      channel.onReload(() => poke()),
      channel.onReady(() => poke()),
    ]
    unsubscribeChannel = () => {
      for (const off of offs) off()
    }
  }

  const detach = (): void => {
    unsubscribeChannel?.()
    unsubscribeChannel = null
  }

  return {
    async states(): Promise<readonly PrStateWire[]> {
      try {
        const parsed = prStatesWireSchema.parse(
          await channel.request({ op: EClientRequest.ListPrStates, params: {} }),
        )
        held = parsed.states
        return held
      } catch (error) {
        if (error instanceof RemoteRequestFailed) return held
        if (error instanceof RemoteRequestLost) return held
        throw error
      }
    },

    current: () => held,

    onChange(listener) {
      listeners.add(listener)
      attach()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) detach()
      }
    },
  }
}
