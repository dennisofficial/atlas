import type { TurnPolicy } from '@dltech/atlas-harness'

export const settlingPolicy = (args: { settled: Promise<void> }): TurnPolicy => ({
  onOutcome: () => args.settled,
  onCrashed: async () => undefined,
  state: () => ({ type: 'idle' }),
  subscribe: () => () => undefined,
  cancelCompaction: () => false,
  suppress: () => undefined,
  undone: () => null,
})
