import type { AgentIntake } from './agent-intake'
import { combineInput, type InputBatch } from './input-batch'

export function composeIntake(sources: readonly AgentIntake[]): AgentIntake {
  return {
    async prepare(args) {
      const batches: InputBatch[] = []
      try {
        for (const source of sources) {
          const drain = await source.prepare(args)
          batches.push({
            drafts: drain.drafts,
            wakesTurn: drain.wakesTurn,
            acknowledge: () => drain.acknowledge?.(),
            release: () => drain.release?.(),
          })
        }
      } catch (error) {
        for (const batch of batches) batch.release?.()
        throw error
      }
      return combineInput(batches)
    },
    subscribe: (listener) => {
      const stops = sources.flatMap((source) => source.subscribe?.(listener) ?? [])
      return () => {
        for (const stop of stops) stop()
      }
    },
  }
}
