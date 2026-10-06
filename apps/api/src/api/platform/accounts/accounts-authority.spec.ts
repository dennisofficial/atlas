import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { AccountsService } from './accounts.service'
import { EAccountOrigin, EAuthKind, EAuthProvider } from './accounts.types'

const state = vi.hoisted(() => ({ sealedSecret: '' }))
const row = () => ({
  id: 'acc-backup', userId: 'user-owner', provider: 'anthropic', kind: 'oauth',
  origin: 'login', label: 'Native', status: 'active', email: null, subscription: null,
  importedFrom: null, sealedSecret: state.sealedSecret, secretVersion: 0,
  createdAt: new Date('2026-10-05T12:00:00Z'), updatedAt: new Date('2026-10-05T12:00:00Z'),
})

vi.mock('../../../db', () => ({ db: {
  agentAccount: {
    create: async (args: { data: { sealedSecret: string } }) => {
      state.sealedSecret = args.data.sealedSecret
      return row()
    },
    findFirst: async () => row(),
  },
  activeAccount: { findUnique: async () => ({ accountId: 'acc-backup' }) },
} }))

beforeEach(() => { state.sealedSecret = '' })

describe('OAuth authority backup metadata', () => {
  it('round-trips the accepted authorization ID without giving the backup a refresh token', async () => {
    const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: 'a'.repeat(64) }))
    const service = new AccountsService(cipher)
    const authority = {
      url: 'https://cloud.test', connectionId: 'oauth-native', generation: 7,
      refreshAfter: '2026-10-05T12:55:00Z', authorizationId: 'native-login-2',
    }
    await service.add({ userId: 'user-owner', draft: {
      provider: EAuthProvider.Anthropic, label: 'Native', origin: EAccountOrigin.Login,
      secret: { kind: EAuthKind.Oauth, tokens: {
        accessToken: 'fake-access', refreshToken: '', expiresAt: '2026-10-05T13:00:00Z',
      }, authority },
    } })
    const stored = await service.read({ userId: 'user-owner', accountId: 'acc-backup' })
    if (stored.secret.kind !== EAuthKind.Oauth) throw new Error('OAuth backup missing')
    expect(stored.secret.authority).toEqual(authority)
    expect(stored.secret.tokens.refreshToken).toBe('')
    expect(state.sealedSecret).not.toContain('fake-access')
  })
})
