import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'

import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { AccountsService } from './accounts.service'
import { EAccountOrigin, EAuthKind, EAuthProvider } from './accounts.types'

describe('OAuth authority backup metadata', () => {
  const database = useTestDatabase()

  beforeEach(async () => {
    await seedUser({ db: database().db, id: 'user-owner' })
  })

  it('round-trips the accepted authorization ID without giving the backup a refresh token', async () => {
    const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: 'a'.repeat(64) }))
    const service = new AccountsService(cipher)
    const authority = {
      url: 'https://cloud.test', connectionId: 'oauth-native', generation: 7,
      refreshAfter: '2026-10-05T12:55:00Z', authorizationId: 'native-login-2',
    }
    const added = await service.add({ userId: 'user-owner', draft: {
      provider: EAuthProvider.Anthropic, label: 'Native', origin: EAccountOrigin.Login,
      secret: { kind: EAuthKind.Oauth, tokens: {
        accessToken: 'fake-access', refreshToken: '', expiresAt: '2026-10-05T13:00:00Z',
      }, authority },
    } })
    const stored = await service.read({ userId: 'user-owner', accountId: added.id })
    if (stored.secret.kind !== EAuthKind.Oauth) throw new Error('OAuth backup missing')
    expect(stored.secret.authority).toEqual(authority)
    expect(stored.secret.tokens.refreshToken).toBe('')
    const row = await database().db.orm.public.AgentAccount.first({ id: added.id })
    expect(row?.sealedSecret).not.toContain('fake-access')
  })
})
