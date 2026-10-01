import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId, type Event, type EventId } from '@dltech/atlas-core'

import { transcriptIdentityDigest } from '../event-identity'

const threadId = toThreadId('thread-digest')

const saidEvent = (args: {
  id: string
  seq: number
  text?: string
  runId?: string
  at?: string
}): Event => {
  const event: Event = {
    id: args.id as EventId,
    seq: args.seq,
    threadId,
    runId: toRunId(args.runId ?? 'run-1'),
    depth: 0,
    at: args.at ?? '2026-09-30T00:00:00.000Z',
    type: 'user-said',
    text: args.text ?? 'hello',
  }
  return event
}

describe('transcriptIdentityDigest', () => {
  it('is deterministic for the same events', () => {
    const events = [saidEvent({ id: 'a', seq: 1 }), saidEvent({ id: 'b', seq: 2 })]
    expect(transcriptIdentityDigest(events)).toBe(transcriptIdentityDigest(events))
    expect(transcriptIdentityDigest(events)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('digests an empty log stably', () => {
    expect(transcriptIdentityDigest([])).toBe(transcriptIdentityDigest([]))
  })

  it('ignores the order the reader returned events in', () => {
    const first = saidEvent({ id: 'a', seq: 1 })
    const second = saidEvent({ id: 'b', seq: 2 })
    expect(transcriptIdentityDigest([second, first])).toBe(transcriptIdentityDigest([first, second]))
  })

  it('ignores fields outside the identity', () => {
    const base = saidEvent({ id: 'a', seq: 1, text: 'one' })
    const restamped = saidEvent({ id: 'a', seq: 1, text: 'two', runId: 'run-9', at: '2030-01-01T00:00:00.000Z' })
    expect(transcriptIdentityDigest([restamped])).toBe(transcriptIdentityDigest([base]))
  })

  it('changes when an event id changes', () => {
    expect(transcriptIdentityDigest([saidEvent({ id: 'a', seq: 1 })])).not.toBe(
      transcriptIdentityDigest([saidEvent({ id: 'b', seq: 1 })]),
    )
  })

  it('changes when an event seq changes', () => {
    expect(transcriptIdentityDigest([saidEvent({ id: 'a', seq: 1 })])).not.toBe(
      transcriptIdentityDigest([saidEvent({ id: 'a', seq: 2 })]),
    )
  })

  it('changes when an event type changes', () => {
    const said = saidEvent({ id: 'a', seq: 1 })
    const nudged: Event = {
      id: said.id,
      seq: said.seq,
      threadId,
      runId: said.runId,
      depth: 0,
      at: said.at,
      type: 'nudge',
      text: 'carry on',
      lifetimeSteps: 1,
    }
    expect(transcriptIdentityDigest([nudged])).not.toBe(transcriptIdentityDigest([said]))
  })
})
