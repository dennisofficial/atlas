import { describe, expect, it } from 'bun:test'

import { versionLines } from '../build-info'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('versionLines', () => {
  it('puts the Mac version on its own line above the web build', () => {
    expect(
      versionLines({ web: { commit: SHA, version: '1.42.0' }, desktopVersion: '1.41.0' }),
    ).toEqual(['Atlas for Mac 1.41.0', 'web v1.42.0 · 0123456'])
  })

  it('shows only the web line on plain web', () => {
    expect(versionLines({ web: { commit: SHA, version: '' }, desktopVersion: null })).toEqual([
      'web 0123456',
    ])
  })

  it('shows the Mac version alone when the web build is unstamped', () => {
    expect(versionLines({ web: { commit: '', version: '' }, desktopVersion: '1.41.0' })).toEqual([
      'Atlas for Mac 1.41.0',
    ])
  })

  it('is empty when nothing is known', () => {
    expect(versionLines({ web: { commit: '', version: '' }, desktopVersion: '' })).toEqual([])
  })
})
