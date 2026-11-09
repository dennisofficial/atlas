import { describe, expect, it } from 'bun:test'

import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { activeTabOf, currentUrlOf, freshBrowser, openTab } from '../browser-model'
import { previewCallbackUrlOf, previewOriginFor, openPreviewCallback } from '../preview-callback'

const PATH = '/api/auth/callback/google?code=c&state=s'
const CALLBACK = `https://callback.byatlas.dev${PATH}`

const web: PreviewPort = {
  id: 'service:web',
  port: 3000,
  label: 'web',
  url: 'https://3000-abcdefghij.byatlas.dev',
  status: EPreviewStatus.Live,
}
const api: PreviewPort = {
  id: 'service:api',
  port: 4000,
  label: 'api',
  url: 'https://4000-abcdefghij.byatlas.dev',
  status: EPreviewStatus.Stopped,
}

const storybook: PreviewPort = {
  id: 'service:sb',
  port: 6006,
  label: 'storybook',
  url: 'https://6006-abcdefghij.byatlas.dev',
  status: EPreviewStatus.Live,
}

describe('previewOriginFor', () => {
  it('keeps the preview the tab is on, and falls back to the first live port', () => {
    expect(
      previewOriginFor({
        currentUrl: 'https://6006-abcdefghij.byatlas.dev/x',
        ports: [web, storybook],
      }),
    ).toBe('https://6006-abcdefghij.byatlas.dev')
    expect(previewOriginFor({ currentUrl: 'https://example.com/', ports: [api, web] })).toBe(
      'https://3000-abcdefghij.byatlas.dev',
    )
    expect(previewOriginFor({ currentUrl: 'https://example.com/', ports: [api] })).toBeNull()
  })
})

describe('previewCallbackUrlOf', () => {
  it('moves a provider callback onto the session preview, path and query intact', () => {
    expect(
      previewCallbackUrlOf({ url: CALLBACK, currentUrl: 'https://example.com/', ports: [web] }),
    ).toBe(`https://3000-abcdefghij.byatlas.dev${PATH}`)
  })

  it('leaves other hosts, the Mac handoff and a session without a live port alone', () => {
    expect(
      previewCallbackUrlOf({ url: PATH, currentUrl: 'https://example.com/', ports: [web] }),
    ).toBeNull()
    expect(
      previewCallbackUrlOf({
        url: 'https://callback.byatlas.dev/__atlas/start?to=x',
        currentUrl: 'https://example.com/',
        ports: [web],
      }),
    ).toBeNull()
    expect(
      previewCallbackUrlOf({ url: CALLBACK, currentUrl: 'https://example.com/', ports: [api] }),
    ).toBeNull()
  })
})

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
