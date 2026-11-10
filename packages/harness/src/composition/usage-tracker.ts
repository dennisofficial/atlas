import {
  contextTokens,
  type Chunk,
  type EventLogPort,
  type ModelUsage,
  type ThreadId,
} from '@dltech/atlas-core'

import type { DeltaChannel } from '../channel/delta-channel'
import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'

/**
 * How full the window stands, as the last call that reported usage left it. A turn that ends without
 * a reading (Paused, Interrupted before its events landed) leaves the window unmeasured rather than
 * guessed at. Idle means the turn did not run at all, so its zero says nothing about the window.
 */
export function createUsageTracker(args: { channel: DeltaChannel; log: EventLogPort }) {
  const reported = new Map<ThreadId, ModelUsage>()

  const remember = ({ threadId, usage }: { threadId: ThreadId; usage: ModelUsage }): void => {
    reported.set(threadId, usage)
  }

  return {
    usageOf: async ({
      threadId,
      outcome,
    }: {
      threadId: ThreadId
      outcome: TurnOutcome
    }): Promise<number | null> => {
      if (outcome.status === ETurnStatus.Idle) return 0
      return contextTokens(reported.get(threadId) ?? null)
    },

    onChunk: ({ threadId, chunk }: { threadId: ThreadId; chunk: Chunk }): void => {
      if (chunk.type === 'finish' && chunk.usage !== undefined) {
        remember({ threadId, usage: chunk.usage })
      }
    },

    subscribe: ({ threadId }: { threadId: ThreadId }): (() => void) =>
      args.channel.subscribe({
        threadId,
        listener: (signal) => {
          if (
            signal.type === 'chunk' &&
            signal.chunk.type === 'finish' &&
            signal.chunk.usage !== undefined
          ) {
            remember({ threadId, usage: signal.chunk.usage })
          }
        },
      }),
  }
}

export type UsageTracker = ReturnType<typeof createUsageTracker>
