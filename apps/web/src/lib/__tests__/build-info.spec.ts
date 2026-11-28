import { describe, expect, it } from 'bun:test'

import { expectedVersionLines, versionLines } from '../build-info'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('versionLines', () => {
  it('puts the Mac version on its own line above the web build', () => {
    expect(
      versionLines({ web: { commit: SHA, version: '1.42.0' }, desktopVersion: '1.41.0' }),
    ).toEqual(['App 1.41.0', 'Interface 1.42.0, 0123456'])
  })

  it('shows only the interface line on plain web', () => {
    expect(versionLines({ web: { commit: SHA, version: '' }, desktopVersion: null })).toEqual([
      'Interface 0123456',
    ])
  })

  it('shows the app version alone when the interface build is unstamped', () => {
    expect(versionLines({ web: { commit: '', version: '' }, desktopVersion: '1.41.0' })).toEqual([
      'App 1.41.0',
    ])
  })

  it('is empty when nothing is known', () => {
    expect(versionLines({ web: { commit: '', version: '' }, desktopVersion: '' })).toEqual([])
  })
})

describe('expectedVersionLines', () => {
  it('reserves the app line in the Mac app before the host answers', () => {
    expect(
      expectedVersionLines({ web: { commit: SHA, version: '1.42.0' }, isDesktop: true }),
    ).toHaveLength(2)
  })

  it('reserves only the interface line on plain web', () => {
    expect(expectedVersionLines({ web: { commit: SHA, version: '' }, isDesktop: false })).toEqual([
      'Interface 0123456',
    ])
  })

  it('reserves nothing when no version is known', () => {
    expect(expectedVersionLines({ web: { commit: '', version: '' }, isDesktop: false })).toEqual([])
  })
})
