import { describe, expect, it } from 'bun:test'

import {
  distanceFromBottom,
  EScrollGesture,
  EScrollSignal,
  FOLLOWING_TAIL,
  followsTailAfterUserScroll,
  NEAR_BOTTOM_PX,
  tailFollowAfter,
  type TTailFollow,
} from '../tail-follow'

const metrics = ({
  offset,
  content,
  viewport,
}: {
  offset: number
  content: number
  viewport: number
}) => ({
  contentOffset: { y: offset },
  contentSize: { height: content },
  layoutMeasurement: { height: viewport },
})

const AT_END = metrics({ offset: 1200, content: 2000, viewport: 800 })
const SHORT_OF_END = metrics({ offset: 700, content: 2000, viewport: 800 })

const run = (signals: EScrollSignal[], state: TTailFollow = FOLLOWING_TAIL) =>
  signals.reduce(
    (current, signal) =>
      tailFollowAfter({
        state: current,
        signal,
        metrics: SHORT_OF_END,
      }),
    state,
  )

describe('distanceFromBottom', () => {
  it('is zero when the viewport ends at the content end', () => {
    expect(distanceFromBottom(AT_END)).toBe(0)
  })
})

describe('followsTailAfterUserScroll', () => {
  it('keeps following when the user lets go near the bottom', () => {
    expect(
      followsTailAfterUserScroll(
        metrics({ offset: 1200 - NEAR_BOTTOM_PX + 1, content: 2000, viewport: 800 }),
      ),
    ).toBe(true)
  })

  it('stops following when the user lets go further up', () => {
    expect(followsTailAfterUserScroll(metrics({ offset: 400, content: 2000, viewport: 800 }))).toBe(
      false,
    )
  })
})

describe('tailFollowAfter', () => {
  it('keeps following when a scroll the app made ends short of the end', () => {
    const next = tailFollowAfter({
      state: FOLLOWING_TAIL,
      signal: EScrollSignal.EndMomentum,
      metrics: SHORT_OF_END,
    })
    expect(next).toEqual(FOLLOWING_TAIL)
  })

  it('stops following while the user drags', () => {
    expect(run([EScrollSignal.BeginDrag])).toEqual({
      following: false,
      gesture: EScrollGesture.Dragging,
    })
  })

  it('stops following when the user lets go up in the transcript', () => {
    expect(run([EScrollSignal.BeginDrag, EScrollSignal.EndDrag]).following).toBe(false)
  })

  it('follows again when the user lets go at the end', () => {
    const dragged = run([EScrollSignal.BeginDrag])
    expect(
      tailFollowAfter({ state: dragged, signal: EScrollSignal.EndDrag, metrics: AT_END }),
    ).toEqual(FOLLOWING_TAIL)
  })

  it('stays off the tail while a fling glides, then decides where it stops', () => {
    const gliding = run([
      EScrollSignal.BeginDrag,
      EScrollSignal.EndDrag,
      EScrollSignal.BeginMomentum,
    ])
    expect(gliding).toEqual({ following: false, gesture: EScrollGesture.Gliding })
    expect(
      tailFollowAfter({ state: gliding, signal: EScrollSignal.EndMomentum, metrics: AT_END }),
    ).toEqual(FOLLOWING_TAIL)
  })

  it('ignores the end of a scroll the app made after the user stopped following', () => {
    const stopped = run([EScrollSignal.BeginDrag, EScrollSignal.EndDrag])
    expect(
      tailFollowAfter({ state: stopped, signal: EScrollSignal.EndMomentum, metrics: AT_END }),
    ).toEqual(stopped)
  })
})
