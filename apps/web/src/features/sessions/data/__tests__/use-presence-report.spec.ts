import { describe, expect, it } from 'bun:test'

import { EClientSurface } from '@dltech/atlas-core'

import { presenceStateOf, surfaceOf } from '../use-presence-report'

describe('presenceStateOf', () => {
  it('is foreground when the page is visible and the window has focus', () => {
    expect(
      presenceStateOf({ sessionId: 'session-1', visibilityState: 'visible', focused: true }),
    ).toEqual({ sessionId: 'session-1', foreground: true })
  })

  it('is away when the window lost focus', () => {
    expect(
      presenceStateOf({ sessionId: 'session-1', visibilityState: 'visible', focused: false }),
    ).toEqual({ sessionId: 'session-1', foreground: false })
  })

  it('is away when the tab is hidden', () => {
    expect(
      presenceStateOf({ sessionId: 'session-1', visibilityState: 'hidden', focused: true }),
    ).toEqual({ sessionId: 'session-1', foreground: false })
  })

  it('carries a null session for a client on the list', () => {
    expect(presenceStateOf({ sessionId: null, visibilityState: 'visible', focused: true })).toEqual(
      { sessionId: null, foreground: true },
    )
  })
})

describe('surfaceOf', () => {
  it('names the desktop host', () => {
    expect(surfaceOf({ atlasDesktop: { vibrancy: true } })).toBe(EClientSurface.Desktop)
  })

  it('names a plain browser window as web', () => {
    expect(surfaceOf({})).toBe(EClientSurface.Web)
  })
})
