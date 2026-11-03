import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor } from '../../events/body'
import { summarisePoints, summariseReach } from '../summarise-points'
import { compacted, eventsFrom, replied, said } from './fixture'

describe('summarisePoints', () => {
  it('offers nothing on a single message', () => {
    expect(summarisePoints(eventsFrom([said('go'), replied('done')])).size).toBe(0)
  })

  it('offers up-to from the second message and from-here while two messages remain', () => {
    const events = eventsFrom([
      said('one'),
      replied('a'),
      said('two'),
      replied('b'),
      said('three'),
      replied('c'),
    ])
    const points = summarisePoints(events)

    expect(points.get('evt-1')).toEqual({
      upTo: null,
      from: { anchor: ECompactionAnchor.Suffix, seq: 1, messages: 3 },
    })
    expect(points.get('evt-3')).toEqual({
      upTo: { anchor: ECompactionAnchor.Prefix, seq: 2, messages: 1 },
      from: { anchor: ECompactionAnchor.Suffix, seq: 3, messages: 2 },
    })
    expect(points.get('evt-5')).toEqual({
      upTo: { anchor: ECompactionAnchor.Prefix, seq: 4, messages: 2 },
      from: null,
    })
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
    expect(points.get('evt-4')?.upTo).toBeNull()
    expect(points.get('evt-6')?.upTo).toEqual({
      anchor: ECompactionAnchor.Prefix,
      seq: 5,
      messages: 1,
    })
  })

  it('reads the reach for an anchor', () => {
    const point = summarisePoints(eventsFrom([said('one'), said('two')])).get('evt-2')
    if (point === undefined) throw new Error('expected a point')

    expect(summariseReach({ point, anchor: ECompactionAnchor.Prefix })?.seq).toBe(1)
    expect(summariseReach({ point, anchor: ECompactionAnchor.Suffix })).toBeNull()
  })
})
