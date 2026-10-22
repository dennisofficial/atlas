import { describe, expect, it } from 'bun:test'

import {
  assetNameFor,
  nextBinaryPathFor,
  sha256HexOf,
  shouldStage,
  stagedVersionMarkerPathFor,
  verifySha256,
} from '../self-update-asset'

describe('assetNameFor', () => {
  it('maps every supported darwin and linux target', () => {
    expect(assetNameFor({ platform: 'darwin', arch: 'arm64' })).toBe('atlas-darwin-arm64')
    expect(assetNameFor({ platform: 'darwin', arch: 'x64' })).toBe('atlas-darwin-x64')
    expect(assetNameFor({ platform: 'linux', arch: 'x64' })).toBe('atlas-linux-x64')
  })

  it('has no asset for anything else, so self-update falls back to notice-only', () => {
    expect(assetNameFor({ platform: 'win32', arch: 'x64' })).toBeNull()
    expect(assetNameFor({ platform: 'linux', arch: 'arm64' })).toBeNull()
    expect(assetNameFor({ platform: 'darwin', arch: 'ia32' })).toBeNull()
  })
})

describe('nextBinaryPathFor / stagedVersionMarkerPathFor', () => {
  it('stages next to the running binary so a later rename stays on one filesystem', () => {
    expect(nextBinaryPathFor('/opt/atlas/atlas')).toBe('/opt/atlas/atlas.next')
    expect(stagedVersionMarkerPathFor('/opt/atlas/atlas')).toBe('/opt/atlas/atlas.next.version')
  })
})

describe('sha256HexOf', () => {
  it('reads the hex digest out of a shasum sidecar line', () => {
    const sidecar = `${'a'.repeat(64)}  atlas-darwin-arm64\n`
    expect(sha256HexOf(sidecar)).toBe('a'.repeat(64))
  })

  it('is case-insensitive and tolerates a bare hex line', () => {
    expect(sha256HexOf('B'.repeat(64))).toBe('b'.repeat(64))
  })

  it('reads nothing out of a line that never carries a digest', () => {
    expect(sha256HexOf('not a sidecar')).toBeNull()
    expect(sha256HexOf('')).toBeNull()
  })
})

describe('verifySha256', () => {
  const data = new TextEncoder().encode('atlas binary contents')
  const correctHex = new Bun.CryptoHasher('sha256').update(data).digest('hex')

  it('passes when the sidecar names the actual digest of the bytes', () => {
    expect(verifySha256({ data, sidecarText: `${correctHex}  atlas-darwin-arm64\n` })).toBe(true)
  })

  it('fails when the bytes were tampered with or truncated', () => {
    const corrupted = new TextEncoder().encode('atlas binary contents, but different')
    expect(verifySha256({ data: corrupted, sidecarText: `${correctHex}  asset\n` })).toBe(false)
  })

  it('fails when the sidecar carries no readable digest', () => {
    expect(verifySha256({ data, sidecarText: 'gh api rate limited' })).toBe(false)
  })
})

describe('shouldStage', () => {
  const v = (major: number, minor = 0, patch = 0) => ({ major, minor, patch, prerelease: null })

  it('stages when nothing has been staged yet', () => {
    expect(shouldStage({ stagedVersion: null, targetVersion: v(2) })).toBe(true)
  })

  it('stages again when the staged copy is older than the target release', () => {
    expect(shouldStage({ stagedVersion: v(1), targetVersion: v(2) })).toBe(true)
  })

  it('skips a redundant download when the target is already staged', () => {
    expect(shouldStage({ stagedVersion: v(2), targetVersion: v(2) })).toBe(false)
  })

  it('skips when the staged copy is somehow already ahead of the target', () => {
    expect(shouldStage({ stagedVersion: v(3), targetVersion: v(2) })).toBe(false)
  })
})
