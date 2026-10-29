import { describe, expect, it } from 'bun:test'

import { isAtEnd, isDownwardKey, isDownwardWheel } from '../chat-follow'

describe('chat follow', () => {
  it('treats a viewport within the edge threshold as at the end', () => {
    expect(isAtEnd({ scrollTop: 1381, clientHeight: 480, scrollHeight: 1861 })).toBe(true)
    expect(isAtEnd({ scrollTop: 1375, clientHeight: 480, scrollHeight: 1861 })).toBe(true)
    expect(isAtEnd({ scrollTop: 1381, clientHeight: 480, scrollHeight: 1907 })).toBe(false)
  })

  it('only counts downward wheel and key input as staying at the end', () => {
    expect(isDownwardWheel(40)).toBe(true)
    expect(isDownwardWheel(-40)).toBe(false)
    expect(isDownwardKey('End')).toBe(true)
    expect(isDownwardKey('PageDown')).toBe(true)
    expect(isDownwardKey('ArrowUp')).toBe(false)
    expect(isDownwardKey('Home')).toBe(false)
  })
})
