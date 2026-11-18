import { describe, expect, it } from 'bun:test'

import { apiBaseUrlOf } from '../api-base-url'

const browserHost: object = {}

const desktopHost: object = { atlasDesktop: { nativeBrowser: true } }

describe('apiBaseUrlOf', () => {
  it('calls the hosted API from a browser on Vercel production and preview', () => {
    expect(apiBaseUrlOf({ host: browserHost, env: { VERCEL_ENV: 'production' } })).toBe(
      'https://api.byatlas.io',
    )
    expect(apiBaseUrlOf({ host: browserHost, env: { VERCEL_ENV: 'preview' } })).toBe(
      'https://api.byatlas.io',
    )
  })

  it('prefers the API origin inlined into the build', () => {
    expect(
      apiBaseUrlOf({ host: browserHost, env: { ATLAS_API_ORIGIN: 'https://api.byatlas.dev' } }),
    ).toBe('https://api.byatlas.dev')
  })

  it('calls the local API from a browser in development', () => {
    expect(apiBaseUrlOf({ host: browserHost, env: {} })).toBe('http://localhost:3400')
  })

  it('stays relative under the Mac host, which proxies to the API itself', () => {
    expect(apiBaseUrlOf({ host: desktopHost, env: { VERCEL_ENV: 'production' } })).toBe('')
  })

  it('stays relative where there is no host to read', () => {
    expect(apiBaseUrlOf({ host: null, env: {} })).toBe('')
  })
})
