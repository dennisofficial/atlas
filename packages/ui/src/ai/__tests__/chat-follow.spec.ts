import { describe, expect, it } from 'bun:test'

import {
  EChatFollow,
  EFollowEvent,
  isAtEnd,
  isDetachingKey,
  isUpwardTouch,
  isUpwardWheel,
  isUserDriven,
  nextFollow,
  type FollowEvent,
} from '../chat-follow'

const run = (events: FollowEvent[], from: EChatFollow = EChatFollow.Attached) =>
  events.reduce(nextFollow, from)

const layoutScroll: FollowEvent = { type: EFollowEvent.Scrolled, atEnd: false, userDriven: false }

describe('chat follow', () => {
  it('treats a viewport within the edge threshold as at the end', () => {
    expect(isAtEnd({ scrollOffset: 1381, viewportSize: 480, scrollSize: 1861 })).toBe(true)
    expect(isAtEnd({ scrollOffset: 1375, viewportSize: 480, scrollSize: 1861 })).toBe(true)
    expect(isAtEnd({ scrollOffset: 1381, viewportSize: 480, scrollSize: 1907 })).toBe(false)
  })

  it('stays attached through layout-driven offset decreases and growth gaps', () => {
    expect(run([layoutScroll, layoutScroll, layoutScroll])).toBe(EChatFollow.Attached)
  })

  it('detaches on upward user input and ignores scroll events that are not at the end', () => {
    expect(run([{ type: EFollowEvent.UserScrolledUp }, layoutScroll])).toBe(EChatFollow.Detached)
    expect(
      run([
        { type: EFollowEvent.UserScrolledUp },
        { type: EFollowEvent.Scrolled, atEnd: false, userDriven: true },
      ]),
    ).toBe(EChatFollow.Detached)
  })

  it('does not re-attach when a layout change lands at the end without user input', () => {
    expect(
      run([
        { type: EFollowEvent.UserScrolledUp },
        { type: EFollowEvent.Scrolled, atEnd: true, userDriven: false },
      ]),
    ).toBe(EChatFollow.Detached)
  })

  it('re-attaches when the user scrolls back to the end', () => {
    expect(
      run([
        { type: EFollowEvent.UserScrolledUp },
        { type: EFollowEvent.Scrolled, atEnd: true, userDriven: true },
      ]),
    ).toBe(EChatFollow.Attached)
  })

  it('re-attaches on jump and on send', () => {
    expect(run([{ type: EFollowEvent.Reattached }], EChatFollow.Detached)).toBe(
      EChatFollow.Attached,
    )
  })

  it('only counts upward wheel deltas as detaching', () => {
    expect(isUpwardWheel(-1)).toBe(true)
    expect(isUpwardWheel(0)).toBe(false)
    expect(isUpwardWheel(40)).toBe(false)
  })

  it('only counts a finger dragging content down as detaching', () => {
    expect(isUpwardTouch({ previousY: 100, currentY: 130 })).toBe(true)
    expect(isUpwardTouch({ previousY: 130, currentY: 100 })).toBe(false)
    expect(isUpwardTouch({ previousY: 100, currentY: 100 })).toBe(false)
  })

  it('detaches on PageUp, ArrowUp and Home only', () => {
    expect(isDetachingKey('PageUp')).toBe(true)
    expect(isDetachingKey('ArrowUp')).toBe(true)
    expect(isDetachingKey('Home')).toBe(true)
    expect(isDetachingKey('ArrowDown')).toBe(false)
    expect(isDetachingKey('End')).toBe(false)
    expect(isDetachingKey('a')).toBe(false)
  })

  it('treats scrolling as user driven while a pointer is held or input was recent', () => {
    expect(isUserDriven({ now: 1000, lastInputAt: 700, pointerHeld: false })).toBe(true)
    expect(isUserDriven({ now: 2000, lastInputAt: 700, pointerHeld: false })).toBe(false)
    expect(isUserDriven({ now: 2000, lastInputAt: 700, pointerHeld: true })).toBe(true)
  })
})
