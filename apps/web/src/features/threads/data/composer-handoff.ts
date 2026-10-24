import type { PendingEntryWire, WireEvent } from '@dltech/atlas-wire/web'

import { userBodyOf } from './take-back'

export type Handoff = { sendId: string; text: string }

export const HANDOFF_TIMEOUT_MS = 3000

export const isHandedOff = (args: {
  handoff: Handoff
  events: readonly WireEvent[]
  pending: readonly PendingEntryWire[]
}): boolean =>
  args.events.some((event) => userBodyOf(event)?.requestId === args.handoff.sendId) ||
  args.pending.some((entry) => entry.text === args.handoff.text)

export const clearedDraftOf = (args: { current: string; handoff: Handoff }): string =>
  args.current.trim() === args.handoff.text ? '' : args.current
