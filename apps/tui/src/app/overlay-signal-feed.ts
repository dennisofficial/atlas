import type { ChannelSignal } from '@dltech/atlas-client/channel'
import { overlaySignalsOf, type OverlaySignalSource } from '@dltech/atlas-client/stream'

import type { SignalFeed } from '../store/conversation-store-types'

export type OverlaySignalFeed = {
  signals: SignalFeed
  publish: (source: OverlaySignalSource) => void
}

export function overlaySignalFeed(): OverlaySignalFeed {
  const listeners = new Set<(signal: ChannelSignal) => void>()
  let held: OverlaySignalSource | undefined

  return {
    signals: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
    },
    publish: (source) => {
      const signals = overlaySignalsOf({ previous: held, next: source })
      held = source
      for (const signal of signals) for (const listener of [...listeners]) listener(signal)
    },
  }
}
