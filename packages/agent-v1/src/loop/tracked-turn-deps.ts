import type { Assembled, ToolDeclaration } from '@dltech/atlas-core'

import type { SettlePending } from './settle-pending'

export type TrackedTurnDeps = Omit<
  import('./turn-deps').TurnDeps,
  'logPort' | 'dispatch' | 'output' | 'spend'
> & {
  onContext: ((args: { tokens: number; window: number }) => void) | undefined
  tools: () => readonly ToolDeclaration[]
  countTokens: (assembled: Assembled) => number
  settlePending: SettlePending | undefined
  autoCompactAtPercent: () => number
  launchDirectory: string
}
