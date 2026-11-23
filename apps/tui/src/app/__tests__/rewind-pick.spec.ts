import { describe, expect, it } from 'bun:test'

import { ERewindPointKind, ERewindVerb, type RewindPoint } from '../../ui/rewind-model'
import { rewindCommandOf } from '../rewind-pick'

const POINT: RewindPoint = {
  kind: ERewindPointKind.Said,
  seq: 7,
  eventId: 'event-7',
  text: 'tidy the loop',
  images: [],
}

describe('the command a drawer pick runs', () => {
  it('rewinds to the message itself', () => {
    expect(rewindCommandOf({ point: POINT, verb: ERewindVerb.ToHere })).toEqual({
      name: 'rewind',
      args: { toSeq: 7 },
    })
  })

  it('summarises everything before the message', () => {
    expect(rewindCommandOf({ point: POINT, verb: ERewindVerb.SummariseUpTo })).toEqual({
      name: 'summarise',
      args: { throughSeq: 6 },
    })
  })

  it('rewinds to a compaction at its own seq', () => {
    const point: RewindPoint = {
      kind: ERewindPointKind.Compacted,
      seq: 4,
      text: '',
      replaced: 3,
    }
    expect(rewindCommandOf({ point, verb: ERewindVerb.ToHere })).toEqual({
      name: 'rewind',
      args: { toSeq: 4 },
    })
  })
})
