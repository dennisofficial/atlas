import {
  contextTokens,
  estimateEventTokens,
  type Chunk,
  type EventLogPort,
  type ModelUsage,
  type ThreadId,
} from '@dltech/atlas-core'

import type { DeltaChannel } from '../channel/delta-channel'
import { ETurnStatus, type TurnOutcome } from '../loop/turn-outcome'

/**
 * How full the window stands, learned rather than asked: the channel carries every step's reported
 * usage, so watching it beats re-reading the log after each turn — and a turn that ended with an
 * answered call (Paused, Interrupted before its events landed) leaves no fresh reading, where the
 * estimate from the log is the truthful remainder. Idle means the turn did not run at all, so its
 * zero says nothing about the window.
 */
export function createUsageTracker(args: { channel: DeltaChannel; log: EventLogPort }) {
  const reported = new Map<ThreadId, ModelUsage>()

  const remember = ({ threadId, usage }: { threadId: ThreadId; usage: ModelUsage }): void => {
    reported.set(threadId, usage)
  }

  return {
    usageOf: async ({ threadId, outcome }: { threadId: ThreadId; outcome: TurnOutcome }): Promise<number> => {
      const latest = reported.get(threadId)
      if (outcome.status === ETurnStatus.Completed || outcome.status === ETurnStatus.Failed) {
        return latest === undefined
          ? estimateEventTokens(await args.log.read({ threadId }))
          : contextTokens({ reported: latest, events: [] })
      }
      if (outcome.status === ETurnStatus.Idle) return 0
      return estimateEventTokens(await args.log.read({ threadId }))
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
          if (signal.type === 'chunk' && signal.chunk.type === 'finish' && signal.chunk.usage !== undefined) {
            remember({ threadId, usage: signal.chunk.usage })
          }
        },
      }),
  }
}

export type UsageTracker = ReturnType<typeof createUsageTracker>
