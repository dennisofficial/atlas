import { describe, expect, it } from 'bun:test'

import { rowFillOf } from '../session-row-fill'

describe('rowFillOf', () => {
  it('keeps the sidebar accent wash in dark mode', () => {
    expect(rowFillOf({ dark: true }).selected).toEqual({ color: 'sidebarAccent', alpha: 1 })
  })

  it('fills a selected row with a stronger foreground tint in light mode', () => {
    const fill = rowFillOf({ dark: false })
    expect(fill.selected.color).toBe('foreground')
    expect(fill.selected.alpha).toBeGreaterThan(0.15)
    expect(fill.selected.alpha).toBeGreaterThan(fill.pressed.alpha)
  })

  it('gives a pressed unselected row a lighter wash than a selected row', () => {
    const fill = rowFillOf({ dark: false })
    expect(fill.pressed.alpha).toBeGreaterThan(0)
    expect(fill.pressed.alpha).toBeLessThan(fill.selected.alpha)
  })
})
