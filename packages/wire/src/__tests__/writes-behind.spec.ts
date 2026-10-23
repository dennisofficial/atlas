import { describe, expect, it } from 'bun:test'

import { API_PROVISIONED_ENV, writesBehind } from '../boot-progress-wire'

describe('writesBehind', () => {
  it('holds for an api-provisioned pod and for any pod told a url and a token', () => {
    expect(writesBehind({ [API_PROVISIONED_ENV]: '1' })).toBe(true)
    expect(
      writesBehind({ ATLAS_CLOUD_URL: 'https://api.example.com', ATLAS_SERVE_TOKEN: 't' }),
    ).toBe(true)
  })

  it('does not hold without both a url and a token', () => {
    expect(writesBehind({})).toBe(false)
    expect(writesBehind({ ATLAS_CLOUD_URL: 'https://api.example.com' })).toBe(false)
    expect(writesBehind({ ATLAS_SERVE_TOKEN: 't' })).toBe(false)
    expect(writesBehind({ ATLAS_CLOUD_URL: ' ', ATLAS_SERVE_TOKEN: 't' })).toBe(false)
  })
})
