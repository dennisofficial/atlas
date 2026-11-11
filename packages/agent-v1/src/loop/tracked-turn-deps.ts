import type { ToolDeclaration } from '@dltech/atlas-core'

import type { SettlePending } from './settle-pending'

export type TrackedTurnDeps = Omit<
  import('./turn-deps').TurnDeps,
  'logPort' | 'dispatch' | 'output' | 'spend'
> & {
  tools: () => readonly ToolDeclaration[]
  settlePending: SettlePending | undefined
  launchDirectory: string
}
