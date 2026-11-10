import type { ERetryReason } from '@dltech/atlas-core'

import type { ToolOutputNotice } from './settle-pending'

export type AgentOutputEvent =
  | { type: 'tool-output'; output: ToolOutputNotice }
  | {
      type: 'retrying'
      attempt: number
      maxAttempts: number
      reason: ERetryReason
      delayMs: number
    }

export type AgentOutput = { emit(event: AgentOutputEvent): void }
