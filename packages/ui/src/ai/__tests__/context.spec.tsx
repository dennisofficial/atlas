import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  Context,
  ContextBreakdown,
  breakdownPercentOf,
  contextPercent,
  contextToneOf,
  formatTokens,
} from '../context'

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

  it('shows only the percentage in the trigger and names it for screen readers', () => {
    const html = renderToStaticMarkup(<Context used={50_000} limit={200_000} />)

    expect(html.replace(/<[^>]+>/g, '').trim()).toBe('25%')
    expect(html).toContain('aria-label="25% of context used"')
  })

  it('draws a ring beside the percentage', () => {
    const html = renderToStaticMarkup(<Context used={50_000} limit={200_000} />)

    expect(html).toContain('data-slot="context-ring"')
    expect(html).toContain('stroke-dasharray')
  })

  it('draws an empty ring when nothing measured the window', () => {
    const html = renderToStaticMarkup(<Context used={null} limit={200_000} />)

    expect(html).toContain('data-slot="context-ring"')
    expect(html).not.toContain('stroke-dasharray')
  })

  it('warns as the window fills', () => {
    expect(contextToneOf(null)).toBe('text-muted-foreground')
    expect(contextToneOf(69)).toBe('text-foreground')
    expect(contextToneOf(70)).toBe('text-warning')
    expect(contextToneOf(90)).toBe('text-destructive')
  })

  it('shows an em dash and says so when nothing measured the window', () => {
    const html = renderToStaticMarkup(<Context used={null} limit={200_000} />)

    expect(html.replace(/<[^>]+>/g, '').trim()).toBe('—')
    expect(html).toContain('Context not measured yet')
  })

  it('says the split is estimated and draws each row with its share of the window', () => {
    const html = renderToStaticMarkup(
      <ContextBreakdown
        rows={[
          { label: 'System prompt', tokens: 6_200 },
          { label: 'Tools', tokens: 14_800 },
        ]}
        limit={200_000}
      />,
    )

    expect(html).toContain('Estimated')
    expect(html).toContain('System prompt')
    expect(html).toContain('6.2k, 3%')
    expect(html).toContain('14.8k, 7%')
  })

  it('shows no estimate caption without a breakdown', () => {
    const html = renderToStaticMarkup(<ContextBreakdown rows={[]} limit={200_000} />)

    expect(html).not.toContain('Estimated')
  })

  it('computes a row share of the window and tolerates an empty window', () => {
    expect(breakdownPercentOf({ tokens: 6_200, limit: 200_000 })).toBe(3)
    expect(breakdownPercentOf({ tokens: 100, limit: 0 })).toBe(0)
  })
})
