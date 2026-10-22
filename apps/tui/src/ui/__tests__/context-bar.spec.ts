import { describe, expect, it } from 'bun:test'

import {
  CONTEXT_DANGER_TOKENS,
  CONTEXT_WARN_PERCENT,
  CONTEXT_WARN_TOKENS,
  contextTone,
  contextUsageTone,
  isContextWarning,
} from '../context-bar'
import { theme } from '../theme'

describe('isContextWarning', () => {
  it('holds its peace up to the threshold and speaks past it', () => {
    expect(isContextWarning(CONTEXT_WARN_PERCENT)).toBe(false)
    expect(isContextWarning(CONTEXT_WARN_PERCENT + 1)).toBe(true)
  })
})

describe('contextUsageTone', () => {
  it('stays quiet below the warn threshold', () => {
    expect(contextUsageTone(0)).toBe(theme.meta)
    expect(contextUsageTone(CONTEXT_WARN_TOKENS - 1)).toBe(theme.meta)
  })

  it('warns at the warn threshold', () => {
    expect(contextUsageTone(CONTEXT_WARN_TOKENS)).toBe(theme.warn)
    expect(contextUsageTone(CONTEXT_DANGER_TOKENS - 1)).toBe(theme.warn)
  })

  it('reads dangerous at the danger threshold', () => {
    expect(contextUsageTone(CONTEXT_DANGER_TOKENS)).toBe(theme.error)
    expect(contextUsageTone(CONTEXT_DANGER_TOKENS * 2)).toBe(theme.error)
  })
})

describe('contextTone', () => {
  it('stays quiet below both thresholds', () => {
    expect(contextTone({ percent: 10, tokens: 10_000 })).toBe(theme.meta)
  })

  it('stays quiet at the percent threshold', () => {
    expect(contextTone({ percent: CONTEXT_WARN_PERCENT })).toBe(theme.meta)
    expect(isContextWarning(CONTEXT_WARN_PERCENT)).toBe(false)
  })

  it('warns above the percent threshold when tokens are unknown', () => {
    expect(contextTone({ percent: CONTEXT_WARN_PERCENT + 1 })).toBe(theme.warn)
    expect(isContextWarning(CONTEXT_WARN_PERCENT + 1)).toBe(true)
  })

  it('warns on absolute tokens even in a large window', () => {
    expect(contextTone({ percent: 20, tokens: CONTEXT_WARN_TOKENS })).toBe(theme.warn)
  })

  it('reads dangerous on absolute tokens even when the percent is calm', () => {
    expect(contextTone({ percent: 30, tokens: CONTEXT_DANGER_TOKENS })).toBe(theme.error)
  })

  it('lets absolute tokens outrank the percent floor', () => {
    expect(
      contextTone({ percent: CONTEXT_WARN_PERCENT + 1, tokens: CONTEXT_DANGER_TOKENS }),
    ).toBe(theme.error)
  })
})
