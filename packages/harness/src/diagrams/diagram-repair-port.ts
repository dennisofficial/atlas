import type { EventId, ThreadId } from '@dltech/atlas-core'

export type DiagramRepairOutcome =
  | { kind: 'repaired'; repaired: string }
  | { kind: 'failed'; reason: string }

export abstract class DiagramRepairPort {
  abstract repair(args: {
    threadId: ThreadId
    messageId: EventId
    source: string
    error: string
    signal?: AbortSignal | undefined
  }): Promise<DiagramRepairOutcome>
}
