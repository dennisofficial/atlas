import { describe, expect, it } from 'bun:test'

import { clearMomentSeqOf } from '../clear'

describe('clearMomentSeqOf', () => {
  it('clears at a turn end the advance passes', () => {
    expect(
      clearMomentSeqOf({
        previousReadSeq: 3,
        readSeq: 9,
        lastTurnSeq: 7,
        headSeq: 9,
        waiting: false,
      }),
    ).toBe(7)
  })

  it('clears at the head while the session waits for the operator', () => {
    expect(
      clearMomentSeqOf({
        previousReadSeq: 3,
        readSeq: 9,
        lastTurnSeq: 5,
        headSeq: 9,
        waiting: true,
      }),
    ).toBe(9)
  })

  it('counts an absent previous read as nothing read yet', () => {
    expect(
      clearMomentSeqOf({
        previousReadSeq: null,
        readSeq: 2,
        lastTurnSeq: 2,
        headSeq: 2,
        waiting: false,
      }),
    ).toBe(2)
  })

  it('dispatches nothing when the advance stops short of the moment', () => {
    expect(
      clearMomentSeqOf({
        previousReadSeq: 3,
        readSeq: 6,
        lastTurnSeq: 7,
        headSeq: 9,
        waiting: false,
      }),
    ).toBeNull()
  })

  it('dispatches nothing when the moment is already behind the previous read', () => {
    expect(
      clearMomentSeqOf({
        previousReadSeq: 7,
        readSeq: 9,
        lastTurnSeq: 7,
        headSeq: 9,
        waiting: false,
      }),
    ).toBeNull()
  })

  it('dispatches nothing when the session holds no moment', () => {
    expect(
      clearMomentSeqOf({
        previousReadSeq: 0,
        readSeq: 4,
        lastTurnSeq: null,
        headSeq: 4,
        waiting: false,
      }),
    ).toBeNull()
    expect(
      clearMomentSeqOf({
        previousReadSeq: null,
        readSeq: 0,
        lastTurnSeq: null,
        headSeq: 0,
        waiting: true,
      }),
    ).toBeNull()
  })
})
