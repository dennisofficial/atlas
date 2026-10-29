import { describe, expect, it } from 'bun:test'

import { ESignInContext, safeNextPath, signInContextOf, withNext } from '../auth-redirect'

describe('safeNextPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeNextPath('/device?user_code=ABCD1234')).toBe('/device?user_code=ABCD1234')
  })

  it('rejects absolute, protocol-relative and missing values', () => {
    expect(safeNextPath('https://evil.test')).toBeNull()
    expect(safeNextPath('//evil.test')).toBeNull()
    expect(safeNextPath('/\\evil.test')).toBeNull()
    expect(safeNextPath(null)).toBeNull()
  })
})

describe('signInContextOf', () => {
  it('reads the device context off next', () => {
    expect(signInContextOf('/device?user_code=X')).toBe(ESignInContext.Device)
    expect(signInContextOf('/threads/new')).toBe(ESignInContext.Default)
    expect(signInContextOf(null)).toBe(ESignInContext.Default)
  })
})

describe('withNext', () => {
  it('appends an encoded next only when present', () => {
    expect(withNext({ path: '/sign-up', next: null })).toBe('/sign-up')
    expect(withNext({ path: '/sign-up', next: '/device?user_code=A' })).toBe(
      '/sign-up?next=%2Fdevice%3Fuser_code%3DA',
    )
  })
})
