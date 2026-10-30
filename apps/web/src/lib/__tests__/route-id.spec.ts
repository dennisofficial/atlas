import { afterEach, describe, expect, it } from 'bun:test'

import { routeIdAfter, staticParamsForDesktop } from '../route-id'

const original = process.env.ATLAS_WEB_TARGET
afterEach(() => {
  if (original === undefined) delete process.env.ATLAS_WEB_TARGET
  else process.env.ATLAS_WEB_TARGET = original
})

describe('routeIdAfter', () => {
  it('reads and decodes the segment after the marker', () => {
    expect(routeIdAfter({ pathname: '/threads/abc123', segment: 'threads' })).toBe('abc123')
    expect(
      routeIdAfter({
        pathname: '/projects/a%20b/settings/mcp',
        segment: 'projects',
      }),
    ).toBe('a b')
    expect(routeIdAfter({ pathname: '/threads/abc123/', segment: 'threads' })).toBe('abc123')
  })

  it('falls back to the placeholder when absent', () => {
    expect(routeIdAfter({ pathname: '/threads', segment: 'threads' })).toBe('_')
  })
})

describe('staticParamsForDesktop', () => {
  it('emits the placeholder only for the desktop target', () => {
    delete process.env.ATLAS_WEB_TARGET
    expect(staticParamsForDesktop({ threadId: '_' })).toEqual([])
    process.env.ATLAS_WEB_TARGET = 'desktop'
    expect(staticParamsForDesktop({ threadId: '_' })).toEqual([{ threadId: '_' }])
  })
})
