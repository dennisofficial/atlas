import { describe, expect, it } from 'bun:test'

import { activeTabOf, currentUrlOf, freshBrowser, openTab } from '../browser-model'
import { openPreviewCallback } from '../preview-callback'

const PATH = '/api/auth/callback/google?code=c&state=s'

describe('openPreviewCallback', () => {
  it('opens the callback in a new tab on the preview host the user was looking at', () => {
    const state = openTab({
      state: freshBrowser(),
      url: 'https://3000-abcdefghij.byatlas.dev/login',
    })
    const tabId = state.activeId ?? ''
    const next = openPreviewCallback({ state, tabId, path: PATH })
    expect(next.tabs).toHaveLength(state.tabs.length + 1)
    const opened = activeTabOf(next)
    expect(opened?.id).not.toBe(tabId)
    expect(opened === undefined ? '' : currentUrlOf(opened)).toBe(
      `https://3000-abcdefghij.byatlas.dev${PATH}`,
    )
  })

  it('falls back to the active tab when the shown tab is gone', () => {
    const state = openTab({ state: freshBrowser(), url: 'https://6006-abcdefghij.byatlas.dev/' })
    const next = openPreviewCallback({ state, tabId: 'tab-99', path: PATH })
    const opened = activeTabOf(next)
    expect(opened === undefined ? '' : currentUrlOf(opened)).toBe(
      `https://6006-abcdefghij.byatlas.dev${PATH}`,
    )
  })

  it('does nothing when no tab shows a web page', () => {
    const state = freshBrowser()
    expect(openPreviewCallback({ state, tabId: state.activeId ?? '', path: PATH })).toBe(state)
  })
})
