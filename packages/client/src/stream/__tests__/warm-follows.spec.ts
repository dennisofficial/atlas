import { describe, expect, it } from 'bun:test'

import { createWarmFollows } from '../warm-follows'

describe('warm follows', () => {
  it('hands an entry back once', () => {
    const warm = createWarmFollows<string>()
    warm.keep({ key: { sessionId: 'a' }, entry: 'entry-a' })
    expect(warm.take({ sessionId: 'a' })).toBe('entry-a')
    expect(warm.take({ sessionId: 'a' })).toBeUndefined()
  })

  it('tells a thread apart from its session', () => {
    const warm = createWarmFollows<string>()
    warm.keep({ key: { sessionId: 'a', threadId: 't' }, entry: 'thread' })
    expect(warm.take({ sessionId: 'a' })).toBeUndefined()
    expect(warm.take({ sessionId: 'a', threadId: 't' })).toBe('thread')
  })

  it('drops the least recently closed entry past its limit', () => {
    const warm = createWarmFollows<string>(2)
    warm.keep({ key: { sessionId: 'a' }, entry: 'a' })
    warm.keep({ key: { sessionId: 'b' }, entry: 'b' })
    warm.keep({ key: { sessionId: 'a' }, entry: 'a2' })
    warm.keep({ key: { sessionId: 'c' }, entry: 'c' })
    expect(warm.take({ sessionId: 'b' })).toBeUndefined()
    expect(warm.take({ sessionId: 'a' })).toBe('a2')
    expect(warm.take({ sessionId: 'c' })).toBe('c')
  })
})
