import { describe, expect, test } from 'bun:test'

import { EInstallFailure, installPayload } from '../install'
import { fakePayloadFs, manifestOf } from './fixtures'

const archive = new Uint8Array([1, 2, 3])
const sha256 = () => manifestOf().sha256

function install({
  fs = fakePayloadFs().fs,
  download = async () => archive,
  digest = sha256,
} = {}) {
  return installPayload({
    home: '/home',
    manifest: manifestOf(),
    manifestUrl: 'https://example.com/web-update.json',
    fs,
    download,
    sha256: digest,
  })
}

describe('installPayload', () => {
  test('promotes a verified archive and records it as current', async () => {
    const fake = fakePayloadFs()
    const result = await install({ fs: fake.fs })
    expect(result).toEqual({ installed: true, hash: manifestOf().hash })
    expect(fake.calls).toEqual([
      `stage:${manifestOf().hash}`,
      `promote:${manifestOf().hash}`,
      'write-state',
    ])
    expect(fake.state().current).toBe(manifestOf().hash)
    expect(fake.promoted.has(manifestOf().hash)).toBe(true)
  })

  test('keeps the previous payload in the state for rollback', async () => {
    const fake = fakePayloadFs({ state: { current: 'f'.repeat(16) } })
    await install({ fs: fake.fs })
    expect(fake.state()).toEqual({ current: manifestOf().hash, previous: 'f'.repeat(16) })
  })

  test('refuses an archive whose digest does not match', async () => {
    const fake = fakePayloadFs()
    const result = await install({ fs: fake.fs, digest: () => 'b'.repeat(64) })
    expect(result).toEqual({ installed: false, reason: EInstallFailure.HashMismatch })
    expect(fake.calls).toEqual([])
  })

  test('refuses an archive of the wrong size', async () => {
    const result = await install({ download: async () => new Uint8Array([1]) })
    expect(result).toEqual({ installed: false, reason: EInstallFailure.SizeMismatch })
  })

  test('reports a download that never arrived', async () => {
    const result = await install({
      download: async () => {
        throw new Error('offline')
      },
    })
    expect(result).toEqual({ installed: false, reason: EInstallFailure.DownloadFailed })
  })

  test('discards a staging directory when unpacking fails', async () => {
    const fake = fakePayloadFs({ failStage: true })
    const result = await install({ fs: fake.fs })
    expect(result).toEqual({ installed: false, reason: EInstallFailure.WriteFailed })
    expect(fake.calls).toContain(`discard:${manifestOf().hash}`)
    expect(fake.state().current).toBeUndefined()
  })
})
