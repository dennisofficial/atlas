import { describe, expect, it } from 'bun:test'

import { nextReadSeq } from '../read-seq'

describe('nextReadSeq', () => {
  it('takes the requested seq on a first read', () => {
    expect(nextReadSeq({ existing: undefined, seq: 4, head: 10 })).toBe(4)
  })

  it('clamps a first read to head', () => {
    expect(nextReadSeq({ existing: undefined, seq: 40, head: 10 })).toBe(10)
  })

  it('clamps a later read to head', () => {
    expect(nextReadSeq({ existing: 3, seq: 40, head: 10 })).toBe(10)
  })

  it('never regresses while existing is within head', () => {
    expect(nextReadSeq({ existing: 8, seq: 2, head: 10 })).toBe(8)
  })

  it('regresses to the target when existing is past head', () => {
    expect(nextReadSeq({ existing: 20, seq: 5, head: 10 })).toBe(5)
  })
})
