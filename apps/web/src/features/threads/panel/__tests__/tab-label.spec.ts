import { describe, expect, it } from 'bun:test'

import { ERightTab, tabLabel } from '../right-tab'

describe('tabLabel', () => {
  it('calls the preview tab Browser where the host has a native browser', () => {
    expect(tabLabel({ tab: ERightTab.Preview, nativeBrowser: true })).toBe('Browser')
  })

  it('keeps Preview on web and for every other tab', () => {
    expect(tabLabel({ tab: ERightTab.Preview, nativeBrowser: false })).toBe('Preview')
    expect(tabLabel({ tab: ERightTab.Terminal, nativeBrowser: true })).toBe('Terminal')
    expect(tabLabel({ tab: ERightTab.Details, nativeBrowser: true })).toBe('Details')
  })
})
