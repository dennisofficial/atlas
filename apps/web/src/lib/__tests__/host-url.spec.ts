import { describe, expect, it } from 'bun:test'

import { resolveHostOrigin } from '../host-url'

describe('resolveHostOrigin', () => {
  it('follows the stream url to its http origin', () => {
    expect(resolveHostOrigin({ ATLAS_STREAM_URL: 'wss://stream.example.test/stream' })).toBe(
      'https://stream.example.test',
    )
    expect(resolveHostOrigin({ ATLAS_STREAM_URL: 'ws://localhost:10000/stream' })).toBe(
      'http://localhost:10000',
    )
  })

  it('defaults to the hosted agent host in production', () => {
    expect(resolveHostOrigin({ VERCEL_ENV: 'production' })).toBe('https://agent.byatlas.io')
  })
})
