import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { contextChangedSchema } from '../context-changed'
import { isDurable } from '../durability'
import { RECORD_ONLY_TYPES, v2EventSchema, type Hash, type V2Event } from '../event'
import { toLoopEvent } from '../loop-events'

const HASH = 'a'.repeat(64) as Hash
const THREAD = toThreadId('t')
const RUN = toRunId('r')

const changedOf = (paths: readonly string[]): V2Event => ({
  id: toEventId('t:1'),
  seq: 1,
  threadId: THREAD,
  runId: RUN,
  depth: 0,
  at: '2026-11-23T12:00:00.000Z',
  epoch: 1,
  prevHash: HASH,
  type: 'context-changed',
  paths: [...paths],
})

describe('context-changed', () => {
  it('parses the paths the mirror wrote', () => {
    const parsed = contextChangedSchema.safeParse({
      type: 'context-changed',
      paths: ['briefs/plan.md', 'uploads/shot.png'],
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses an empty path', () => {
    expect(contextChangedSchema.safeParse({ type: 'context-changed', paths: [''] }).success).toBe(
      false,
    )
  })

  it('is a record-only event the model never sees', () => {
    expect(RECORD_ONLY_TYPES.has('context-changed')).toBe(true)
    expect(toLoopEvent({ event: changedOf(['notes.md']) })).toBeUndefined()
  })

  it('is not durable, so a replay does not fold it back in', () => {
    expect(isDurable('context-changed')).toBe(false)
  })

  it('round-trips through the event schema', () => {
    const event = changedOf(['notes.md'])
    expect(v2EventSchema.safeParse(JSON.parse(JSON.stringify(event))).success).toBe(true)
  })
})
