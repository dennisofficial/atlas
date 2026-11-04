import type { ThreadId } from '@dltech/atlas-core'

import type { PendingDrain } from '../loop/pending-intake'

export type AgentIntake = {
  prepare(args: { threadId: ThreadId; signal?: AbortSignal | undefined }): Promise<PendingDrain>
  subscribe?(listener: () => void): () => void
}
