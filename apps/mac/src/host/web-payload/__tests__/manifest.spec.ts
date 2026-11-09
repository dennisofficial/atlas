import { describe, expect, test } from 'bun:test'

import { artifactUrl, decidePayload, EPayloadDecision, parseManifest } from '../manifest'
import { manifestOf } from './fixtures'

describe('parseManifest', () => {
  test('accepts a well formed manifest', () => {
    expect(parseManifest({ input: manifestOf() })?.hash).toBe('0123456789abcdef')
  })

  test('rejects hashes that could escape the payload directory', () => {
    expect(parseManifest({ input: manifestOf({ hash: '../../etc' }) })).toBeUndefined()
  })

  test('rejects artifacts outside the tarball shape', () => {
    expect(parseManifest({ input: manifestOf({ artifact: '../evil.tar.gz' }) })).toBeUndefined()
  })

  test('rejects a manifest without a digest', () => {
    expect(parseManifest({ input: { ...manifestOf(), sha256: '' } })).toBeUndefined()
  })
})

describe('decidePayload', () => {
  test('installs a payload that needs this shell', () => {
    const decision = decidePayload({ manifest: manifestOf(), current: 'f'.repeat(16), contract: 1 })
    expect(decision.decision).toBe(EPayloadDecision.Install)
  })

  test('does nothing when the hash is already current', () => {
    const decision = decidePayload({
      manifest: manifestOf(),
      current: manifestOf().hash,
      contract: 1,
    })
    expect(decision.decision).toBe(EPayloadDecision.Current)
  })

  test('refuses a payload that needs a newer shell', () => {
    expect(
      decidePayload({
        manifest: manifestOf({ requiresShell: 2 }),
        current: undefined,
        contract: 1,
      }),
    ).toEqual({
      decision: EPayloadDecision.Refuse,
      reason: 'this payload needs a newer Atlas app',
    })
  })
})

describe('artifactUrl', () => {
  test('resolves next to the manifest', () => {
    expect(
      artifactUrl({ manifest: manifestOf(), manifestUrl: 'https://example.com/a/web-update.json' }),
    ).toBe('https://example.com/a/web-0123456789abcdef.tar.gz')
  })
})
