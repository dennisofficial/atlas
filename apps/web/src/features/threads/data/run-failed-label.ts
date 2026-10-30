import { formatElapsed } from '@dltech/atlas-client/transcript'
import type { Event } from '@dltech/atlas-core'

const BASE = 'run failed'
const MIN_ELAPSED_MS = 1000

export function runFailedLabelOf(args: {
  events: readonly Event[]
  failureSeq: number | null
}): string {
  const { events, failureSeq } = args
  if (failureSeq === null) return BASE
  const failed = events.find((event) => event.seq === failureSeq)
  const started = events.findLast((event) => event.type === 'user-said' && event.seq < failureSeq)
  if (failed === undefined || started === undefined) return BASE
  const elapsedMs = Date.parse(failed.at) - Date.parse(started.at)
  if (!Number.isFinite(elapsedMs) || elapsedMs < MIN_ELAPSED_MS) return BASE
  return `${BASE} after ${formatElapsed(elapsedMs)}`
}
