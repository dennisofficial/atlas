import { describe, expect, it } from 'bun:test'

import { clientVersionHeader, clientVersionOf, EBuildKind, versionLabelOf } from '../info'

describe('clientVersionOf', () => {
  it('uses the version string of a release build', () => {
    expect(
      clientVersionOf({ kind: EBuildKind.Release, version: '1.4.2', releaseRepo: null, buildSha: null }),
    ).toBe('1.4.2')
  })

  it('stamps a dev build so the cloud can tell one checkout from the next', () => {
    expect(clientVersionOf({ kind: EBuildKind.Dev, repo: 'dennis/atlas', stamp: 'abc123' })).toBe(
      'dev+abc123',
    )
  })

  it('falls back to plain dev for a source run, which carries no stamp', () => {
    expect(clientVersionOf({ kind: EBuildKind.Source })).toBe('dev')
  })
})

describe('clientVersionHeader', () => {
  it('answers for whatever kind this run was built as', () => {
    expect(clientVersionHeader().length).toBeGreaterThan(0)
  })
})

describe('versionLabelOf', () => {
  it('prefixes a release version with v, the way the notices spell it', () => {
    expect(versionLabelOf({ kind: EBuildKind.Release, version: '1.4.2', releaseRepo: null, buildSha: null })).toBe(
      'v1.4.2',
    )
  })

  it('leaves dev and source builds alone', () => {
    expect(versionLabelOf({ kind: EBuildKind.Dev, repo: 'dennis/atlas', stamp: 'abc123' })).toBe(
      'dev+abc123',
    )
    expect(versionLabelOf({ kind: EBuildKind.Source })).toBe('dev')
  })
})
