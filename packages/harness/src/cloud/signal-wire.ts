import { z } from 'zod'

import type { ChannelSignal } from '../channel/signal'

const SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'step-started',
  'chunk',
  'step-ended',
  'tool-output',
  'events-appended',
  'retry-waiting',
  'retry-cleared',
])

const carriesKnownSignalType = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false

  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && SIGNAL_TYPES.has(type)
}

export const channelSignalSchema = z.custom<ChannelSignal>(carriesKnownSignalType)
