import { describe, expect, it } from 'bun:test'

import {
  ESshSigningKeyState,
  GITHUB_NOT_CONNECTED_CODE,
  SSH_SIGNING_SCOPE_MISSING_CODE,
  SSH_SIGNING_SCOPE_NOTICE,
  sshSigningKeyLeaseSchema,
  sshSigningKeyStatusSchema,
} from '../index'

describe('signing key wire schemas', () => {
  it('round-trips a lease', () => {
    const lease = {
      publicKey: 'ssh-ed25519 AAAA',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      userName: 'octocat',
      userEmail: '1+octocat@users.noreply.github.com',
    }

    expect(sshSigningKeyLeaseSchema.parse(JSON.parse(JSON.stringify(lease)))).toEqual(lease)
  })

  it.each(['publicKey', 'privateKey', 'userName', 'userEmail'])(
    'refuses a lease with an empty %s',
    (field) => {
      const lease = { publicKey: 'a', privateKey: 'b', userName: 'c', userEmail: 'd', [field]: '' }

      expect(sshSigningKeyLeaseSchema.safeParse(lease).success).toBe(false)
    },
  )

  it('round-trips both status variants', () => {
    const absent = { state: ESshSigningKeyState.Absent as const }
    const registered = {
      state: ESshSigningKeyState.Registered as const,
      publicKey: 'ssh-ed25519 AAAA',
      createdAt: '2026-10-19T00:00:00.000Z',
    }

    expect(sshSigningKeyStatusSchema.parse(absent)).toEqual(absent)
    expect(sshSigningKeyStatusSchema.parse(registered)).toEqual(registered)
  })

  it('refuses a registered status without a public key and an unknown state', () => {
    expect(
      sshSigningKeyStatusSchema.safeParse({ state: 'registered', createdAt: 'x' }).success,
    ).toBe(false)
    expect(sshSigningKeyStatusSchema.safeParse({ state: 'pending' }).success).toBe(false)
  })

  it('pins the error codes and notice the clients match on', () => {
    expect(SSH_SIGNING_SCOPE_MISSING_CODE).toBe('github-signing-scope-missing')
    expect(GITHUB_NOT_CONNECTED_CODE).toBe('github-not-connected')
    expect(SSH_SIGNING_SCOPE_NOTICE).toBe('reconnect GitHub in settings to enable commit signing')
  })
})
