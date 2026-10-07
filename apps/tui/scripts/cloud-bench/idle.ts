import { createHash } from 'node:crypto'
import type { Event } from '@dltech/atlas-core'
import type { TurnSpend } from '@dltech/atlas-harness'

const RELOCATION_EVENTS: ReadonlySet<Event['type']> = new Set([
  'directory-changed',
  'location-changed',
  'worktree-entered',
  'context-loaded',
])

export const assertIdleSuffix = (args: {
  threadId: string
  upTo: number
  events: readonly Pick<Event, 'type' | 'seq'>[]
}): void => {
  const unexpected = args.events.find(
    (event) => event.seq > args.upTo && !RELOCATION_EVENTS.has(event.type),
  )
  if (unexpected !== undefined)
    throw new Error(`unexpected benchmark activity in ${args.threadId}: ${unexpected.type}`)
}

export const turnDigest = (turns: readonly TurnSpend[]): string => {
  const rows = turns
    .toSorted((a, b) => a.runId.localeCompare(b.runId))
    .map((turn) => [
      turn.runId,
      turn.threadId,
      turn.status,
      turn.steps,
      turn.inputTokens,
      turn.outputTokens,
      turn.startedAt,
      turn.endedAt,
    ])
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}
