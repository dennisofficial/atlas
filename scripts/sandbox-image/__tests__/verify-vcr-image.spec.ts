import { describe, expect, it } from 'bun:test'

import { classifyCreateResponse } from '../verify-vcr-image'

describe('classifyCreateResponse', () => {
  it('reads a create as ready', () => {
    expect(classifyCreateResponse({ status: 200, body: { sandbox: { name: 'x' } } })).toBe('ready')
  })

  it('reads still-optimizing as not-ready', () => {
    expect(
      classifyCreateResponse({
        status: 409,
        body: { error: { code: 'image_not_ready', message: 'Image is not ready.' } },
      }),
    ).toBe('not-ready')
  })

  it('reads a failed optimization as poisoned', () => {
    expect(
      classifyCreateResponse({
        status: 409,
        body: { error: { code: 'image_not_ready', message: 'Image optimization failed.' } },
      }),
    ).toBe('poisoned')
  })

  it('reads other statuses and codes as unexpected', () => {
    expect(classifyCreateResponse({ status: 401, body: {} })).toBe('unexpected')
    expect(
      classifyCreateResponse({
        status: 409,
        body: { error: { code: 'drive_conflict', message: 'Image is not ready.' } },
      }),
    ).toBe('unexpected')
    expect(classifyCreateResponse({ status: 409, body: 'gateway timeout' })).toBe('unexpected')
  })
})
