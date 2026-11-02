import {
  MessageIntake as AgentMessageIntake,
  type IntakeDriver,
  type IntakeSource as AgentIntakeSource,
} from '@dltech/atlas-agent'
import type { ThreadId } from '@dltech/atlas-core'

import type { PendingQueue } from '../pending/pending-queue'

export type SubmittedInput = Parameters<PendingQueue['enqueue']>[0] & { threadId: ThreadId }

export type IntakeSource = AgentIntakeSource<SubmittedInput>

export type { IntakeDriver }

export class MessageIntake extends AgentMessageIntake<SubmittedInput> {}
