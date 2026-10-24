import { describe, expect, it } from 'bun:test'

import { resolveApiOrigin } from '../api-origin'

describe('resolveApiOrigin', () => {
  it('prefers an explicit ATLAS_API_ORIGIN', () => {
    expect(
      resolveApiOrigin({ ATLAS_API_ORIGIN: 'https://api.example.test', VERCEL_ENV: 'production' }),
    ).toBe('https://api.example.test')
  })

  it('ignores an empty ATLAS_API_ORIGIN', () => {
    expect(resolveApiOrigin({ ATLAS_API_ORIGIN: '' })).toBe('http://localhost:3400')
  })

  it('uses the hosted API on Vercel production and preview', () => {
    expect(resolveApiOrigin({ VERCEL_ENV: 'production' })).toBe('https://api.byatlas.io')
    expect(resolveApiOrigin({ VERCEL_ENV: 'preview' })).toBe('https://api.byatlas.io')
  })

  it('falls back to localhost otherwise', () => {
    expect(resolveApiOrigin({})).toBe('http://localhost:3400')
    expect(resolveApiOrigin({ VERCEL_ENV: 'development' })).toBe('http://localhost:3400')
  })
})
