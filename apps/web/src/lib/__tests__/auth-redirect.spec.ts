import { describe, expect, it } from 'vitest'

import { ESignInContext, safeNextPath, signInContextOf, withNext } from '../auth-redirect'
import { workspaceSlug } from '../workspace-slug'

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
  it('reads the device and invite contexts off next', () => {
    expect(signInContextOf('/device?user_code=X')).toBe(ESignInContext.Device)
    expect(signInContextOf('/invite/abc')).toBe(ESignInContext.Invite)
    expect(signInContextOf('/threads/new')).toBe(ESignInContext.Default)
    expect(signInContextOf(null)).toBe(ESignInContext.Default)
  })
})

describe('withNext', () => {
  it('appends an encoded next only when present', () => {
    expect(withNext({ path: '/sign-up', next: null })).toBe('/sign-up')
    expect(withNext({ path: '/sign-up', next: '/invite/a' })).toBe('/sign-up?next=%2Finvite%2Fa')
  })
})

describe('workspaceSlug', () => {
  it('derives a lowercase hyphenated slug', () => {
    expect(workspaceSlug('  Analytical Engines! ')).toBe('analytical-engines')
    expect(workspaceSlug('---')).toBe('')
  })
})
