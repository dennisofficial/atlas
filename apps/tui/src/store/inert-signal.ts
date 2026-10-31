import type { ChannelSignal } from '@dltech/atlas-harness'

type InertType =
  | 'events-appended'
  | 'retry-cleared'
  | 'operator-input'
  | 'rotation-changed'
  | 'session-files-changed'
  | 'pending-changed'

const INERT: ReadonlySet<string> = new Set<InertType>([
  'events-appended',
  'retry-cleared',
  'operator-input',
  'rotation-changed',
  'session-files-changed',
  'pending-changed',
])

export const isInertSignal = (
  signal: ChannelSignal,
): signal is Extract<ChannelSignal, { type: InertType }> => INERT.has(signal.type)
