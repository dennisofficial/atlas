import type { Chunk, ERetryReason, EStepEndReason } from '@dltech/atlas-core'

import type { ToolOutputNotice } from './settle-pending'

export type StepKey = { runId: string; step: number; attempt: number }

export type StepStreamEvent =
  | { type: 'step-start'; key: StepKey }
  | { type: 'chunk'; key: StepKey; chunk: Chunk }
  | { type: 'step-end'; key: StepKey; reason: EStepEndReason }

export type AgentOutputEvent =
  | { type: 'tool-output'; output: ToolOutputNotice }
  | {
      type: 'retrying'
      attempt: number
      maxAttempts: number
      reason: ERetryReason
      delayMs: number
    }
  | StepStreamEvent

export type AgentOutput = { emit(event: AgentOutputEvent): void }
