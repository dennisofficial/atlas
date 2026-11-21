import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { RECORD_ONLY_TYPES, type Hash, type V2Event } from '../event'
import { toLoopEvent } from '../loop-events'
import { latestResourceOf, resourceFingerprintOf, resourceLoadedSchema } from '../resource-loaded'

const HASH = 'a'.repeat(64) as Hash
const THREAD = toThreadId('t')
const RUN = toRunId('r')

let seq = 0

const loadedOf = (args: { resource: string; fingerprint: string; value: unknown }): V2Event => {
  seq += 1
  return {
    id: toEventId(`t:${seq}`),
    seq,
    threadId: THREAD,
    runId: RUN,
    depth: 0,
    at: '2026-11-20T12:00:00.000Z',
    epoch: 1,
    prevHash: HASH,
    type: 'resource-loaded',
    ...args,
  }
}

describe('resource-loaded', () => {
  it('parses a snapshot with a fingerprint and an opaque value', () => {
    const parsed = resourceLoadedSchema.safeParse({
      type: 'resource-loaded',
      resource: 'skills',
      fingerprint: 'i:0:unversioned:/w',
      value: { entries: [] },
    })
    expect(parsed.success).toBe(true)
  })

  it('refuses a snapshot with no fingerprint', () => {
    const parsed = resourceLoadedSchema.safeParse({
      type: 'resource-loaded',
      resource: 'skills',
      fingerprint: '',
      value: null,
    })
    expect(parsed.success).toBe(false)
  })

  it('is a record-only event the model never sees', () => {
    expect(RECORD_ONLY_TYPES.has('resource-loaded')).toBe(true)
    const event = loadedOf({
      resource: 'skills',
      fingerprint: 'i:0:unversioned:/w',
      value: [],
    })
    expect(toLoopEvent({ event })).toBeUndefined()
  })

  it('reads the last snapshot recorded for a resource', () => {
    const events = [
      loadedOf({ resource: 'skills', fingerprint: 'first', value: ['a'] }),
      loadedOf({ resource: 'crew', fingerprint: 'other', value: ['c'] }),
      loadedOf({ resource: 'skills', fingerprint: 'second', value: ['b'] }),
    ]
    expect(latestResourceOf({ events, resource: 'skills' })).toEqual({
      fingerprint: 'second',
      value: ['b'],
    })
  })

  it('finds nothing for a resource that was never recorded', () => {
    const events = [loadedOf({ resource: 'crew', fingerprint: 'other', value: [] })]
    expect(latestResourceOf({ events, resource: 'skills' })).toBeUndefined()
  })

  it('builds a fingerprint that marks a watch with no seq as unarmed', () => {
    expect(
      resourceFingerprintOf({
        instance: 'i',
        seq: 3,
        cloud: 'v1|v2',
        directory: '/w',
      }),
    ).toBe('i:3:v1|v2:/w')
    expect(
      resourceFingerprintOf({ instance: 'i', seq: undefined, cloud: '', directory: '/w' }),
    ).toBe('i:unarmed::/w')
  })
})
