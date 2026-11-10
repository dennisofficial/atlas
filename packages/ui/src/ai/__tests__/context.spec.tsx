import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Context, contextPercent, formatTokens } from '../context'

describe('Context', () => {
  it('computes the usage percentage', () => {
    expect(contextPercent({ used: 50_000, limit: 200_000 })).toBe(25)
    expect(contextPercent({ used: 1, limit: 3 })).toBe(33)
  })

  it('clamps to 100 and tolerates a zero limit', () => {
    expect(contextPercent({ used: 300, limit: 200 })).toBe(100)
    expect(contextPercent({ used: 10, limit: 0 })).toBeNull()
  })

  it('has no percentage before a call reported usage', () => {
    expect(contextPercent({ used: null, limit: 200_000 })).toBeNull()
  })

  it('formats token counts', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12_400)).toBe('12.4k')
    expect(formatTokens(1_000_000)).toBe('1.0M')
  })

  it('shows the percentage in the trigger', () => {
    const html = renderToStaticMarkup(<Context used={50_000} limit={200_000} />)

    expect(html.replace(/<[^>]+>/g, '')).toContain('25% context')
  })

  it('shows an em dash and says so when nothing measured the window', () => {
    const html = renderToStaticMarkup(<Context used={null} limit={200_000} />)

    expect(html.replace(/<[^>]+>/g, '').trim()).toBe('—')
    expect(html).toContain('Context not measured yet')
  })
})
