import { describe, expect, it } from 'bun:test'

import { uploadFractionOf } from '../upload-fraction'

describe('uploadFractionOf', () => {
  it('reads the BigInt counters iOS reports', () => {
    expect(uploadFractionOf({ bytesSent: 512n, totalBytes: 2048n })).toBe(0.25)
  })

  it('keeps a fraction below one instead of truncating BigInt division to zero', () => {
    expect(uploadFractionOf({ bytesSent: 1n, totalBytes: 3n })).toBeCloseTo(1 / 3)
  })

  it('reads plain numbers', () => {
    expect(uploadFractionOf({ bytesSent: 30, totalBytes: 60 })).toBe(0.5)
  })

  it('clamps to the unit range', () => {
    expect(uploadFractionOf({ bytesSent: 90n, totalBytes: 60n })).toBe(1)
    expect(uploadFractionOf({ bytesSent: -1, totalBytes: 60 })).toBe(0)
  })

  it('reports nothing while the total is unknown', () => {
    expect(uploadFractionOf({ bytesSent: 10n, totalBytes: 0n })).toBeUndefined()
    expect(uploadFractionOf({ bytesSent: 10, totalBytes: -1 })).toBeUndefined()
  })
})
