import { describe, expect, test } from 'bun:test'

import { certificateVerdictOf, createHostTrust } from '../host-trust.js'

const FINGERPRINT = 'sha256/AbCdEf0123456789'
const TRUSTED = 0
const CHROMIUM_DEFAULT = -3

function fakeSession() {
  const state = { calls: 0, proc: undefined }
  return {
    state,
    session: {
      setCertificateVerifyProc: (proc) => {
        state.calls += 1
        state.proc = proc
      },
    },
    verdictOf: (request) =>
      new Promise((resolve) => {
        state.proc(request, resolve)
      }),
  }
}

describe('certificateVerdictOf', () => {
  test('trusts the loopback host when its fingerprint was recorded', () => {
    const verdict = certificateVerdictOf({
      hostname: '127.0.0.1',
      fingerprint: FINGERPRINT,
      trusted: new Set([FINGERPRINT]),
    })
    expect(verdict).toBe(TRUSTED)
  })

  test('defers to Chromium for another host even with a recorded fingerprint', () => {
    const verdict = certificateVerdictOf({
      hostname: 'example.com',
      fingerprint: FINGERPRINT,
      trusted: new Set([FINGERPRINT]),
    })
    expect(verdict).toBe(CHROMIUM_DEFAULT)
  })

  test('defers to Chromium for a loopback certificate nobody recorded', () => {
    const verdict = certificateVerdictOf({
      hostname: '127.0.0.1',
      fingerprint: 'sha256/unknown',
      trusted: new Set([FINGERPRINT]),
    })
    expect(verdict).toBe(CHROMIUM_DEFAULT)
  })
})

describe('createHostTrust', () => {
  test('installs the verify proc once and judges every request through it', async () => {
    const fake = fakeSession()
    const trust = createHostTrust({ sessionOf: () => fake.session })
    trust.install()
    trust.install()
    expect(fake.state.calls).toBe(1)

    trust.trust(FINGERPRINT)
    const trusted = await fake.verdictOf({
      hostname: '127.0.0.1',
      certificate: { fingerprint: FINGERPRINT },
    })
    const unknown = await fake.verdictOf({
      hostname: '127.0.0.1',
      certificate: { fingerprint: 'sha256/other' },
    })
    const foreign = await fake.verdictOf({
      hostname: 'byatlas.io',
      certificate: { fingerprint: FINGERPRINT },
    })
    const missing = await fake.verdictOf({ hostname: '127.0.0.1', certificate: null })

    expect([trusted, unknown, foreign, missing]).toEqual([
      TRUSTED,
      CHROMIUM_DEFAULT,
      CHROMIUM_DEFAULT,
      CHROMIUM_DEFAULT,
    ])
    expect(trust.trusted()).toEqual([FINGERPRINT])
  })

  test('records a second host certificate, so a swapped interface is trusted too', async () => {
    const fake = fakeSession()
    const trust = createHostTrust({ sessionOf: () => fake.session })
    trust.install()
    trust.trust(FINGERPRINT)
    trust.trust('sha256/Second')
    trust.trust('')
    expect(trust.trusted()).toEqual([FINGERPRINT, 'sha256/Second'])
    const second = await fake.verdictOf({
      hostname: '127.0.0.1',
      certificate: { fingerprint: 'sha256/Second' },
    })
    expect(second).toBe(TRUSTED)
  })
})
