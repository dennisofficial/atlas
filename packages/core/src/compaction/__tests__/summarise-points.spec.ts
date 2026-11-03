import { describe, expect, it } from 'bun:test'

import { summarisePoints } from '../summarise-points'
import { compacted, eventsFrom, replied, said } from './fixture'

describe('summarisePoints', () => {
  it('offers nothing on a single message', () => {
    expect(summarisePoints(eventsFrom([said('go'), replied('done')])).size).toBe(0)
  })

  it('offers up-to from the second message, counting the messages before it', () => {
    const events = eventsFrom([
      said('one'),
      replied('a'),
      said('two'),
      replied('b'),
      said('three'),
      replied('c'),
    ])
    const points = summarisePoints(events)

    expect(points.has('evt-1')).toBe(false)
    expect(points.get('evt-3')).toEqual({ throughSeq: 2, messages: 1 })
    expect(points.get('evt-5')).toEqual({ throughSeq: 4, messages: 2 })
  })

  it('skips messages a summary already speaks for', () => {
    const events = eventsFrom([
      said('one'),
      replied('a'),
      compacted(2, 'the opening'),
      said('two'),
      replied('b'),
      said('three'),
    ])
    const points = summarisePoints(events)

    expect(points.has('evt-1')).toBe(false)
    expect(points.has('evt-4')).toBe(false)
    expect(points.get('evt-6')).toEqual({ throughSeq: 5, messages: 1 })
  })
})
