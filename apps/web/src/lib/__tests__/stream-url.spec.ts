import { describe, expect, it } from 'bun:test'

import { resolveStreamUrl } from '../stream-url'

describe('resolveStreamUrl', () => {
  it('prefers an explicit ATLAS_STREAM_URL', () => {
    expect(
      resolveStreamUrl({ ATLAS_STREAM_URL: 'wss://stream.example.test', VERCEL_ENV: 'production' }),
    ).toBe('wss://stream.example.test')
  })

  it('ignores an empty ATLAS_STREAM_URL', () => {
    expect(resolveStreamUrl({ ATLAS_STREAM_URL: '' })).toBe('ws://localhost:10000/stream')
  })

  it('uses the hosted stream on Vercel production and preview', () => {
    expect(resolveStreamUrl({ VERCEL_ENV: 'production' })).toBe('wss://agent.byatlas.io/stream')
    expect(resolveStreamUrl({ VERCEL_ENV: 'preview' })).toBe('wss://agent.byatlas.io/stream')
  })

  it('uses the hosted stream in the desktop build', () => {
    expect(resolveStreamUrl({ ATLAS_WEB_TARGET: 'desktop' })).toBe('wss://agent.byatlas.io/stream')
  })

  it('falls back to the local agent host otherwise', () => {
    expect(resolveStreamUrl({})).toBe('ws://localhost:10000/stream')
    expect(resolveStreamUrl({ VERCEL_ENV: 'development' })).toBe('ws://localhost:10000/stream')
  })
})
