import type { Assembled, ToolDeclaration } from '@dltech/atlas-core'

import type { SettlePending } from './settle-pending'

export type TrackedTurnDeps = Omit<
  import('./run-turn').TurnDeps,
  'logPort' | 'dispatch' | 'onToolOutput' | 'spend'
> & {
  tools: () => readonly ToolDeclaration[]
  countTokens: (assembled: Assembled) => number
  settlePending: SettlePending | undefined
  autoCompactAtPercent: () => number
  launchDirectory: string
}
