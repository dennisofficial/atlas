import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor } from '../../events/body'
import { EExecutionLocation } from '../../execution/location'
import { replacedRanges } from '../watermark'
import { compactedRange, eventsFrom, loaded, movedLocation, replied, said } from './fixture'

describe('replacedRanges', () => {
  it('is empty without a watermark', () => {
    expect(replacedRanges(eventsFrom([said('go'), replied('done')]))).toEqual([])
  })

  it('names the range a summary replaced, where only spared rows are left standing in it', () => {
    const events = eventsFrom([
      loaded('file', 'CLAUDE.md', 'guidance'),
      compactedRange({ fromSeq: 1, throughSeq: 2, summary: 'the opening' }),
      said('next'),
    ])

    expect(replacedRanges(events)).toEqual([{ fromSeq: 1, throughSeq: 2 }])
  })

  it('ignores a compaction whose rows are still underneath, since nothing was replaced', () => {
    const events = eventsFrom([
      said('go'),
      replied('done'),
      compactedRange({ fromSeq: 1, throughSeq: 2, summary: 'the opening' }),
      said('next'),
    ])

    expect(replacedRanges(events)).toEqual([])
  })

  it('names the range of a suffix summary that discarded the tail', () => {
    const events = eventsFrom([
      said('keep this'),
      compactedRange({ fromSeq: 2, throughSeq: 8, summary: 'the tail', anchor: ECompactionAnchor.Suffix }),
      loaded('file', 'CLAUDE.md', 'guidance'),
    ])

    expect(replacedRanges(events)).toEqual([{ fromSeq: 2, throughSeq: 8 }])
  })

  it('calls a range replaced when only a spared location-changed marker is left standing in it', () => {
    const events = eventsFrom([
      movedLocation({ from: EExecutionLocation.Host, to: EExecutionLocation.Cloud }),
      compactedRange({ fromSeq: 1, throughSeq: 1, summary: 'the session lifted' }),
      said('next'),
    ])

    expect(replacedRanges(events)).toEqual([{ fromSeq: 1, throughSeq: 1 }])
  })
})
