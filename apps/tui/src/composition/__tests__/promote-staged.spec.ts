import { describe, expect, it } from 'bun:test'

import { EBuildKind } from '../../build/info'
import { shouldPromoteStaged } from '../promote-staged'

const RELEASE = {
  kind: EBuildKind.Release,
  running: '0.7.0',
  staged: '0.8.0',
  nextExists: true,
} as const

describe('shouldPromoteStaged', () => {
  it('promotes when a newer staged binary is waiting on disk', () => {
    expect(shouldPromoteStaged({ ...RELEASE })).toBe(true)
  })

  it('never promotes into the same or an older version', () => {
    expect(shouldPromoteStaged({ ...RELEASE, staged: '0.7.0' })).toBe(false)
    expect(shouldPromoteStaged({ ...RELEASE, staged: '0.6.0' })).toBe(false)
  })

  it('stays put without a staged binary on disk, whatever the marker says', () => {
    expect(shouldPromoteStaged({ ...RELEASE, nextExists: false })).toBe(false)
  })

  it('stays put without a readable marker, whatever is on disk', () => {
    expect(shouldPromoteStaged({ ...RELEASE, staged: null })).toBe(false)
    expect(shouldPromoteStaged({ ...RELEASE, staged: 'not-a-version' })).toBe(false)
  })

  it('never promotes a dev or source build, whose exec path is not a release binary', () => {
    expect(shouldPromoteStaged({ ...RELEASE, kind: EBuildKind.Dev })).toBe(false)
    expect(shouldPromoteStaged({ ...RELEASE, kind: EBuildKind.Source })).toBe(false)
  })
})
