import type { ToolDeclaration } from '@dltech/atlas-core'

import type { AgentOutput } from './agent-output'
import type { SettlePending } from './settle-pending'

export type TrackedTurnDeps = Omit<
  import('./turn-deps').TurnDeps,
  'logPort' | 'dispatch' | 'output' | 'spend'
> & {
  streamOutput: AgentOutput | undefined
  tools: () => readonly ToolDeclaration[]
  settlePending: SettlePending | undefined
  launchDirectory: string
}
