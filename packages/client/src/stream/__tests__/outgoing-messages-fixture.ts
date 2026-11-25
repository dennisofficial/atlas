import type { RecordEvent } from '@dltech/atlas-core'

export type PartialEvent = { type: string } & Record<string, unknown>

export const eventsOf = (partials: readonly PartialEvent[]): RecordEvent[] =>
  partials.map(
    (partial, index) =>
      ({
        id: `event-${index}`,
        seq: index + 1,
        threadId: 'thread',
        runId: 'run',
        depth: 0,
        at: '2026-11-18T00:00:00.000Z',
        epoch: 0,
        prevHash: 'a'.repeat(64),
        ...partial,
      }) as unknown as RecordEvent,
  )

export const STAGED = [
  { clientId: 'client-a', text: 'first' },
  { clientId: 'client-b', text: 'second' },
]
