import type { EHarnessPlacement, ERunner, ThreadId } from '@dltech/atlas-core'

import type { ChannelSignal } from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'

const FIRST_SEND_SIGNALS: ReadonlySet<ChannelSignal['type']> = new Set([
  'events-appended',
  'step-started',
  'turn-working',
])

export const startsTheThread = (signal: ChannelSignal): boolean => FIRST_SEND_SIGNALS.has(signal.type)

export type BornPlacementState = {
  threadId: ThreadId
  harness: EHarnessPlacement
  runner?: ERunner | undefined
  provisioning: boolean
  /** Set when a cloud→host flip rebirths the thread: the operator's draft crosses the id change. */
  carriedDraft?: boolean | undefined
}

export type BornPlacementChip = {
  snapshot: () => BornPlacementState | null
  subscribe: (listener: () => void) => () => void
  set: (state: BornPlacementState | null) => void
  retire: (threadId: ThreadId) => void
  bindFlip: (flip: () => void) => () => void
  flip: () => void
}

const chips = new WeakMap<object, BornPlacementChip>()

function createChip(): BornPlacementChip {
  const listeners = new Set<() => void>()
  let held: BornPlacementState | null = null
  let flipper: (() => void) | null = null

  const put = (next: BornPlacementState | null): void => {
    held = next
    for (const listener of [...listeners]) listener()
  }

  return {
    snapshot: () => held,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: put,
    retire: (threadId) => {
      if (held?.threadId === threadId) put(null)
    },
    bindFlip: (flip) => {
      flipper = flip
      return () => {
        if (flipper === flip) flipper = null
      }
    },
    flip: () => flipper?.(),
  }
}

export function bornPlacementChip(app: Pick<AtlasApp, 'sessionOwner'>): BornPlacementChip {
  const existing = chips.get(app.sessionOwner)
  if (existing !== undefined) return existing
  const created = createChip()
  chips.set(app.sessionOwner, created)
  return created
}
