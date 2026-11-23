import { describe, expect, it } from 'bun:test'

import { latestRotationOf, NO_ROTATION, projectedEvents, rotationStartSeq } from '../rotation'
import { log } from '../../assembly/__tests__/log-fixture'

const first = log([
  { type: 'user-said', text: 'one' },
  { type: 'rotated', handoff: 'first brief' },
  { type: 'user-said', text: 'two' },
  { type: 'rotated', handoff: 'second brief' },
  { type: 'user-said', text: 'three' },
])

describe('latestRotationOf', () => {
  it('is undefined when the thread never rotated', () => {
    expect(latestRotationOf(log([{ type: 'user-said', text: 'hi' }]))).toBeUndefined()
  })

  it('returns the last rotation marker', () => {
    expect(latestRotationOf(first)?.handoff).toBe('second brief')
  })
})

describe('rotationStartSeq', () => {
  it('is NO_ROTATION without a boundary', () => {
    expect(rotationStartSeq(log([{ type: 'user-said', text: 'hi' }]))).toBe(NO_ROTATION)
  })

  it('is the seq of the last boundary', () => {
    expect(rotationStartSeq(first)).toBe(4)
  })
})

describe('projectedEvents', () => {
  it('returns the whole log when there is no boundary', () => {
    const events = log([{ type: 'user-said', text: 'one' }])
    expect(projectedEvents(events)).toEqual(events)
  })

  it('returns the boundary and its tail', () => {
    const events = log([
      { type: 'user-said', text: 'one' },
      { type: 'rotated', handoff: 'brief' },
      { type: 'user-said', text: 'two' },
    ])
    expect(projectedEvents(events).map((event) => event.seq)).toEqual([2, 3])
  })

  it('returns only the later tail when the thread rotated twice', () => {
    expect(projectedEvents(first).map((event) => event.seq)).toEqual([4, 5])
  })
})
