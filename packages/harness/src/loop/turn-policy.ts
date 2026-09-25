import type { ThreadId } from '@dltech/atlas-core'

import type { PendingSaid } from '../pending'

import type { TurnOutcome } from './turn-outcome'

export enum ESuppress {
  None = 'none',
  UndoOnce = 'undo-once',
}

export type TurnPolicyState = { type: 'idle' } | { type: 'compacting'; startedAt: number }

export type TurnPolicyListener = (state: TurnPolicyState) => void

/**
 * What a settled turn triggers beyond itself, and who it tells. The composition root builds the
 * runner and every surface observes the same transitions: the TUI draws the compaction pill off
 * them and serve renders them through its notice port.
 */
export type TurnPolicy = {
  onOutcome: (args: { threadId: ThreadId; outcome: TurnOutcome }) => Promise<void>
  onCrashed: (args: { threadId: ThreadId }) => Promise<void>
  state: () => TurnPolicyState
  subscribe: (listener: TurnPolicyListener) => () => void
  cancelCompaction: () => boolean
  suppress: (what: ESuppress) => void
  undone: () => PendingSaid | null
}
