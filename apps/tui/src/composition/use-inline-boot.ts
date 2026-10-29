import { useMemo, useSyncExternalStore } from 'react'

import type { ThreadId } from '@dltech/atlas-core'

import { EPendingKind, type PendingRow } from '../store'
import { bootBlocks, type BootBlock } from './boot-block-store'
import { bornPlacementChip } from './cloud/born-placement-chip'
import type { AtlasApp } from './compose'
import type { SendArgs } from './conversation-types'

const NO_ARRIVALS: readonly SendArgs[] = Object.freeze([])

export type InlineBoot = {
  block: BootBlock | null
  arrivalRows: readonly PendingRow[]
  active: boolean
}

export function useInlineBoot(args: {
  app: Pick<AtlasApp, 'sessionOwner'>
  threadId: ThreadId
}): InlineBoot {
  const store = bootBlocks(args.app)
  const chip = bornPlacementChip(args.app)
  const held = useSyncExternalStore(store.subscribe, store.snapshot)
  const born = useSyncExternalStore(chip.subscribe, chip.snapshot)
  const block = held?.threadId === args.threadId ? held : null
  const arrivals = born?.threadId === args.threadId ? (born.arrivals ?? NO_ARRIVALS) : NO_ARRIVALS

  return useMemo(
    () => ({
      block,
      arrivalRows: arrivals.map(
        (send, index): PendingRow => ({
          kind: EPendingKind.Sending,
          id: `arrival:${index}`,
          text: send.text,
          failed: false,
        }),
      ),
      active: block !== null || arrivals.length > 0,
    }),
    [block, arrivals],
  )
}
