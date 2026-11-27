import { describe, expect, it } from 'bun:test'

import {
  EMcpSignInSurface,
  returnSurfaceOf,
  signInStartUrlOf,
  signInSurfaceOf,
  signInUrlFor,
} from '../sign-in-start'

const START = 'https://api.byatlas.io/mcp-oauth/start/state-1'

describe('signInStartUrlOf', () => {
  it('points at the start path of the public origin', () => {
    expect(signInStartUrlOf({ publicUrl: 'https://api.byatlas.io/v1', state: 'state-1' })).toBe(
      START,
    )
  })
})

describe('signInUrlFor', () => {
  it('names the surface that opens a start url', () => {
    expect(signInUrlFor({ url: START, surface: EMcpSignInSurface.Ios })).toBe(
      `${START}?surface=ios`,
    )
  })

  it('replaces a surface the url already names', () => {
    expect(signInUrlFor({ url: `${START}?surface=web`, surface: EMcpSignInSurface.Desktop })).toBe(
      `${START}?surface=desktop`,
    )
  })

  it('leaves a provider url from an older card untouched', () => {
    const provider = 'https://mcp.linear.app/authorize?state=s&client_id=c'
    expect(signInUrlFor({ url: provider, surface: EMcpSignInSurface.Ios })).toBe(provider)
  })

  it('leaves a url it cannot parse untouched', () => {
    expect(signInUrlFor({ url: 'not a url', surface: EMcpSignInSurface.Web })).toBe('not a url')
  })
})

describe('signInSurfaceOf', () => {
  it('reads a known surface', () => {
    expect(signInSurfaceOf('desktop')).toBe(EMcpSignInSurface.Desktop)
  })

  it('reads nothing from an unknown or missing value', () => {
    expect(signInSurfaceOf('tui')).toBeUndefined()
    expect(signInSurfaceOf(null)).toBeUndefined()
  })
})

describe('returnSurfaceOf', () => {
  it('follows the cookie of the browser that finished the sign-in', () => {
    expect(
      returnSurfaceOf({
        state: 'state-1',
        cookie: { state: 'state-1', surface: EMcpSignInSurface.Ios },
        recorded: EMcpSignInSurface.Desktop,
      }),
    ).toBe(EMcpSignInSurface.Ios)
  })

  it('falls back to the recorded surface when the browser lost the cookie', () => {
    expect(
      returnSurfaceOf({ state: 'state-1', cookie: undefined, recorded: EMcpSignInSurface.Ios }),
    ).toBe(EMcpSignInSurface.Ios)
  })

  it('ignores a cookie left by another sign-in', () => {
    expect(
      returnSurfaceOf({
        state: 'state-1',
        cookie: { state: 'state-0', surface: EMcpSignInSurface.Web },
        recorded: EMcpSignInSurface.Ios,
      }),
    ).toBe(EMcpSignInSurface.Ios)
  })
})
