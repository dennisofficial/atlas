import { describe, expect, it } from 'bun:test'

import { isAtEnd, shouldFollow } from '../chat-follow'

describe('chat follow', () => {
  it('treats a viewport within the edge threshold as at the end', () => {
    expect(isAtEnd({ scrollOffset: 1381, viewportSize: 480, scrollSize: 1861 })).toBe(true)
    expect(isAtEnd({ scrollOffset: 1375, viewportSize: 480, scrollSize: 1861 })).toBe(true)
    expect(isAtEnd({ scrollOffset: 1381, viewportSize: 480, scrollSize: 1907 })).toBe(false)
  })

  it('follows only when it was at the end and the user did not scroll up', () => {
    expect(shouldFollow({ wasAtEnd: true, scrolledUp: false })).toBe(true)
    expect(shouldFollow({ wasAtEnd: true, scrolledUp: true })).toBe(false)
    expect(shouldFollow({ wasAtEnd: false, scrolledUp: false })).toBe(false)
  })
})
