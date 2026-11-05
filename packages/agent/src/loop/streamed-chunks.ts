import { EStepEndReason, type Chunk, type ChunkFilter } from '@dltech/atlas-core'

import type { AgentOutput } from './agent-output'

const STREAMED_TYPES = new Set<Chunk['type']>([
  'text-start',
  'text-delta',
  'text-end',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
])

export type StepStreamer = {
  attempt<T extends { ok: boolean }>(args: {
    filter: ChunkFilter | undefined
    signal: AbortSignal
    run: (filter: ChunkFilter | undefined) => Promise<T>
  }): Promise<T>
}

export const stepStreamerFor = (args: {
  output: AgentOutput | undefined
  runId: string
  step: number
}): StepStreamer | undefined => {
  const { output } = args
  if (output === undefined) return undefined
  let attempts = 0
  return {
    async attempt({ filter, signal, run }) {
      const key = { runId: args.runId, step: args.step, attempt: attempts }
      attempts += 1
      output.emit({ type: 'step-start', key })
      const streamed: ChunkFilter = (chunk) => {
        const kept = filter === undefined ? chunk : filter(chunk)
        if (kept !== null && STREAMED_TYPES.has(kept.type)) {
          output.emit({ type: 'chunk', key, chunk: kept })
        }
        return kept
      }
      let reason = EStepEndReason.Aborted
      try {
        const result = await run(streamed)
        if (result.ok && !signal.aborted) reason = EStepEndReason.Finished
        return result
      } finally {
        output.emit({ type: 'step-end', key, reason })
      }
    },
  }
}
