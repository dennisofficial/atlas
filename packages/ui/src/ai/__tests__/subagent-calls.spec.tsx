import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { generateToolCalls } from '../agents-panel.fixtures'
import { Subagent } from '../subagent'
import { earlierCallsLabel, visibleCalls } from '../subagent-calls'

const calls = generateToolCalls({ count: 312, running: false })

describe('visibleCalls', () => {
  it('keeps every call when no cap is given', () => {
    expect(visibleCalls({ calls })).toEqual({ hidden: 0, visible: calls })
  })

  it('keeps every call at or under the cap', () => {
    expect(visibleCalls({ calls, maxVisibleCalls: 312 }).hidden).toBe(0)
  })

  it('keeps only the last calls over the cap', () => {
    const { hidden, visible } = visibleCalls({ calls, maxVisibleCalls: 5 })

    expect(hidden).toBe(307)
    expect(visible).toEqual(calls.slice(-5))
  })

  it('hides everything at a cap of zero', () => {
    expect(visibleCalls({ calls, maxVisibleCalls: 0 })).toEqual({ hidden: 312, visible: [] })
  })

  it('labels the hidden count', () => {
    expect(earlierCallsLabel(312)).toBe('312 earlier tool calls')
    expect(earlierCallsLabel(1)).toBe('1 earlier tool call')
  })
})

describe('Subagent maxVisibleCalls', () => {
  const render = (props: Partial<Parameters<typeof Subagent>[0]> = {}) =>
    renderToStaticMarkup(<Subagent name="explore" defaultOpen calls={calls} {...props} />)

  it('renders all calls by default', () => {
    const html = render()

    expect(html).toContain('src/module-0.ts')
    expect(html).not.toContain('earlier tool')
  })

  it('renders the tail with a clickable earlier-calls row', () => {
    const html = render({ maxVisibleCalls: 5, onShowAllCalls: () => undefined })

    expect(html).toContain('307 earlier tool calls')
    expect(html).toMatch(/<button[^>]*>307 earlier tool calls<\/button>/)
    expect(html).toContain('symbol311')
    expect(html).not.toContain('src/module-0.ts')
  })

  it('renders a plain muted row without a handler', () => {
    const html = render({ maxVisibleCalls: 5 })

    expect(html).toContain('307 earlier tool calls')
    expect(html).not.toMatch(/<button[^>]*>307 earlier tool calls/)
  })
})
