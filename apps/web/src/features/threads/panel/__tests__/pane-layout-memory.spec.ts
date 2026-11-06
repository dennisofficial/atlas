import { describe, expect, it } from 'bun:test'

import { MAX_REMEMBERED_LAYOUTS, parsePaneLayouts, withPaneLayout } from '../pane-layout-memory'

describe('parsePaneLayouts', () => {
  it('reads stored layouts', () => {
    const raw = JSON.stringify({ a: { transcript: 60, 'right-panel': 40 } })
    expect(parsePaneLayouts(raw)).toEqual({ a: { transcript: 60, 'right-panel': 40 } })
  })

  it('falls back to nothing for missing, malformed or mistyped storage', () => {
    expect(parsePaneLayouts(null)).toEqual({})
    expect(parsePaneLayouts('{not json')).toEqual({})
    expect(parsePaneLayouts(JSON.stringify({ a: { transcript: 'wide' } }))).toEqual({})
  })
})

describe('withPaneLayout', () => {
  it('replaces a thread layout and moves it to the newest slot', () => {
    const next = withPaneLayout({
      layouts: { a: { transcript: 50 }, b: { transcript: 60 } },
      threadId: 'a',
      layout: { transcript: 70 },
    })
    expect(Object.keys(next)).toEqual(['b', 'a'])
    expect(next.a).toEqual({ transcript: 70 })
  })

  it('forgets the least recently resized threads past the cap', () => {
    const layouts = Object.fromEntries(
      Array.from({ length: MAX_REMEMBERED_LAYOUTS }, (_, index) => [
        `t${index}`,
        { transcript: 50 },
      ]),
    )
    const next = withPaneLayout({ layouts, threadId: 'fresh', layout: { transcript: 30 } })
    expect(Object.keys(next)).toHaveLength(MAX_REMEMBERED_LAYOUTS)
    expect(next.t0).toBeUndefined()
    expect(next.fresh).toEqual({ transcript: 30 })
  })
})
