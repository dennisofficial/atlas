import { describe, expect, it } from 'bun:test'

import { exportGpgMaterial, type GpgRunner } from '../gpg-material'
import type { GitRun } from '../run-git'
import type { GitReader } from '../snapshot'

const ok = (stdout: string): GitRun => ({ ok: true, stdout, stderr: '' })

const refused = (stderr = ''): GitRun => ({ ok: false, stdout: '', stderr })

const KEY_ID = 'DEADBEEF1234'

const PUBLIC_ARGS = `--batch --armor --export ${KEY_ID}`
const SECRET_ARGS = `--batch --yes --pinentry-mode loopback --passphrase  --armor --export-secret-keys ${KEY_ID}`
const TRUST_ARGS = '--batch --export-ownertrust'

const reader = (answers: Record<string, GitRun>): GitReader => {
  return async ({ args }) => answers[args.join(' ')] ?? refused()
}

const gpg = (answers: Record<string, GitRun>): GpgRunner => {
  return async ({ args }) => answers[args.join(' ')] ?? refused()
}

const SIGNING_CONFIG = {
  'config user.signingkey': ok(`${KEY_ID}\n`),
  'config commit.gpgsign': ok('true\n'),
}

const FULL_KEYRING = {
  [PUBLIC_ARGS]: ok('PUBLIC BLOCK\n'),
  [SECRET_ARGS]: ok('SECRET BLOCK\n'),
  [TRUST_ARGS]: ok('TRUST\n'),
}

describe('exporting the operator’s gpg material', () => {
  it('answers null when git config names no signing key', async () => {
    const material = await exportGpgMaterial({ cwd: '/work', read: reader({}), gpg: gpg({}) })

    expect(material).toBeNull()
  })

  it('assembles the full material, signing on when commit.gpgsign is true', async () => {
    const material = await exportGpgMaterial({
      cwd: '/work',
      read: reader(SIGNING_CONFIG),
      gpg: gpg(FULL_KEYRING),
    })

    expect(material).toEqual({
      keyId: KEY_ID,
      publicKey: 'PUBLIC BLOCK\n',
      secretKey: 'SECRET BLOCK\n',
      ownerTrust: 'TRUST\n',
      sign: true,
    })
  })

  it('marks signing off when commit.gpgsign is unset', async () => {
    const material = await exportGpgMaterial({
      cwd: '/work',
      read: reader({ 'config user.signingkey': ok(`${KEY_ID}\n`) }),
      gpg: gpg(FULL_KEYRING),
    })

    expect(material?.sign).toBe(false)
  })

  it('answers null when the secret half refuses to export', async () => {
    const material = await exportGpgMaterial({
      cwd: '/work',
      read: reader(SIGNING_CONFIG),
      gpg: gpg({
        ...FULL_KEYRING,
        [SECRET_ARGS]: refused('passphrase-protected key'),
      }),
    })

    expect(material).toBeNull()
  })

  it('answers null when the public half refuses to export', async () => {
    const material = await exportGpgMaterial({
      cwd: '/work',
      read: reader(SIGNING_CONFIG),
      gpg: gpg({
        ...FULL_KEYRING,
        [PUBLIC_ARGS]: refused('no public key'),
      }),
    })

    expect(material).toBeNull()
  })
})
