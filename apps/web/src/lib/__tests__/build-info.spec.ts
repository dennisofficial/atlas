import { describe, expect, it } from 'bun:test'

import { versionLine } from '../build-info'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('versionLine', () => {
  it('shows the Mac version beside the web build', () => {
    expect(versionLine({ web: { commit: SHA, version: '1.42.0' }, desktopVersion: '1.41.0' })).toBe(
      'Atlas for Mac 1.41.0 · web v1.42.0 0123456',
    )
  })

  it('shows only the web commit on plain web', () => {
    expect(versionLine({ web: { commit: SHA, version: '' }, desktopVersion: null })).toBe(
      'web 0123456',
    )
  })

  it('shows the Mac version alone when the web build is unstamped', () => {
    expect(versionLine({ web: { commit: '', version: '' }, desktopVersion: '1.41.0' })).toBe(
      'Atlas for Mac 1.41.0',
    )
  })

  it('is null when nothing is known', () => {
    expect(versionLine({ web: { commit: '', version: '' }, desktopVersion: '' })).toBeNull()
  })
})
