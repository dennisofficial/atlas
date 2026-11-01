import { BadRequestException, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  type CreateAccountInput,
  type SecretInput,
} from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { AccountsService } from './accounts.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

const USER_A = 'user-a'
const USER_B = 'user-b'

function oauthSecret(accessToken: string): SecretInput {
  return {
    kind: EAuthKind.Oauth,
    tokens: {
      accessToken,
      refreshToken: 'refresh-token',
      expiresAt: '2026-10-01T00:00:00.000Z',
    },
  }
}

function draftOf(secret: SecretInput): CreateAccountInput {
  return {
    provider: EAuthProvider.Anthropic,
    label: 'Claude subscription',
    origin: EAccountOrigin.Login,
    secret,
  }
}

function apiKeyDraft(apiKey: string): CreateAccountInput {
  return {
    provider: EAuthProvider.Inference,
    label: 'Inference.net api key',
    origin: EAccountOrigin.Login,
    secret: { kind: EAuthKind.ApiKey, apiKey },
  }
}

describe('AccountsService', () => {
  const database = useTestDatabase()
  const accounts = () => db.orm.public.AgentAccount.where((row) => row.id.neq('')).all()
  const actives = () => db.orm.public.ActiveAccount.where((row) => row.userId.neq('')).all()
  let service: AccountsService

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db: database().db, id })
    service = new AccountsService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
    )
  })

  it('add assigns an acc_ id, active status, and the secret kind', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })

    expect(account.id).toMatch(/^acc_/)
    expect(account.status).toBe(EAccountStatus.Active)
    expect(account.kind).toBe(EAuthKind.Oauth)
    expect(account.createdAt).toBe(account.updatedAt)
    expect(account).not.toHaveProperty('email')
    expect(account).not.toHaveProperty('sealedSecret')
  })

  it('add creates the active pointer only when none exists', async () => {
    const first = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })
    const second = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-2')) })

    const pointers = await actives()
    expect(pointers).toHaveLength(1)
    expect(pointers[0]?.accountId).toBe(first.id)
    expect((await service.activeFor({ userId: USER_A, provider: 'anthropic' })).accountId).not.toBe(
      second.id,
    )
  })

  it('read returns the decrypted secret', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })

    const stored = await service.read({ userId: USER_A, accountId: account.id })
    expect(stored.secret).toEqual({
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: 'at-1',
        refreshToken: 'refresh-token',
        expiresAt: '2026-10-01T00:00:00.000Z',
      },
    })
  })

  it('read omits the account when another user owns it', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })

    await expect(service.read({ userId: USER_B, accountId: account.id })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    await expect(service.list({ userId: USER_B })).resolves.toEqual([])
  })

  it('read, list and lease expose secretVersion, which replaceSecret bumps', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })
    expect(account.secretVersion).toBe(0)

    await service.replaceSecret({
      userId: USER_A,
      accountId: account.id,
      secret: oauthSecret('at-2'),
    })
    await service.replaceSecret({
      userId: USER_A,
      accountId: account.id,
      secret: oauthSecret('at-3'),
    })

    expect((await service.read({ userId: USER_A, accountId: account.id })).secretVersion).toBe(2)
    expect((await service.list({ userId: USER_A }))[0]?.secretVersion).toBe(2)
    expect((await service.lease({ userId: USER_A })).accounts[0]?.secretVersion).toBe(2)
  })

  it('replaceSecret reseals and flips an expired account back to active', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })
    await service.setStatus({
      userId: USER_A,
      accountId: account.id,
      status: EAccountStatus.Expired,
    })
    const sealedBefore = (await accounts())[0]?.sealedSecret

    await service.replaceSecret({
      userId: USER_A,
      accountId: account.id,
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-ant-new' },
    })

    const stored = await service.read({ userId: USER_A, accountId: account.id })
    expect(stored.status).toBe(EAccountStatus.Active)
    expect(stored.kind).toBe(EAuthKind.ApiKey)
    expect(stored.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-ant-new' })
    const [after] = await accounts()
    expect(after?.sealedSecret).not.toBe(sealedBefore)
    expect(after?.sealedSecret).not.toContain('sk-ant-new')
    expect(after?.secretVersion).toBe(1)
  })

  it('remove deletes the row and clears the active pointer', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })

    await service.remove({ userId: USER_A, accountId: account.id })

    expect(await service.list({ userId: USER_A })).toEqual([])
    expect(await service.activeFor({ userId: USER_A, provider: 'anthropic' })).toEqual({
      accountId: null,
    })
  })

  it('remove omits accounts owned by another user', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })

    await expect(service.remove({ userId: USER_B, accountId: account.id })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(await accounts()).toHaveLength(1)
  })

  it('setActive upserts the per-provider pointer', async () => {
    const first = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })
    const second = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-2')) })

    await service.setActive({
      userId: USER_A,
      draft: { provider: EAuthProvider.Anthropic, accountId: second.id },
    })

    const pointers = await actives()
    expect(pointers).toHaveLength(1)
    expect(await service.activeFor({ userId: USER_A, provider: 'anthropic' })).toEqual({
      accountId: second.id,
    })
    expect(pointers[0]?.accountId).not.toBe(first.id)
  })

  it('setActive rejects accounts owned by another user', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })

    await expect(
      service.setActive({
        userId: USER_B,
        draft: { provider: EAuthProvider.Anthropic, accountId: account.id },
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('activeFor returns null when no pointer exists', async () => {
    expect(await service.activeFor({ userId: USER_A, provider: 'openai' })).toEqual({
      accountId: null,
    })
  })

  it('rejects a secret whose shape does not match its kind', async () => {
    await expect(
      service.add({ userId: USER_A, draft: draftOf({ kind: EAuthKind.Oauth }) }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.add({ userId: USER_A, draft: draftOf({ kind: EAuthKind.ApiKey }) }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(await accounts()).toHaveLength(0)
  })

  it('add keeps one api-key account per provider: the second key replaces the first and is active', async () => {
    const first = await service.add({ userId: USER_A, draft: apiKeyDraft('sk-old') })
    await service.setStatus({ userId: USER_A, accountId: first.id, status: EAccountStatus.Expired })
    const second = await service.add({ userId: USER_A, draft: apiKeyDraft('sk-new') })

    expect(second.id).toBe(first.id)
    expect(second.status).toBe(EAccountStatus.Active)
    expect(await accounts()).toHaveLength(1)
    const stored = await service.read({ userId: USER_A, accountId: first.id })
    expect(stored.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-new' })
    expect(await service.activeFor({ userId: USER_A, provider: 'inference' })).toEqual({
      accountId: first.id,
    })
  })

  it('add replaces the secret under concurrent api-key adds', async () => {
    await Promise.all(
      ['sk-1', 'sk-2', 'sk-3'].map((key) =>
        service.add({ userId: USER_A, draft: apiKeyDraft(key) }),
      ),
    )

    expect(await accounts()).toHaveLength(1)
  })

  it('add keeps api-key accounts of different users and providers apart', async () => {
    await service.add({ userId: USER_A, draft: apiKeyDraft('sk-a') })
    await service.add({ userId: USER_B, draft: apiKeyDraft('sk-b') })
    await service.add({
      userId: USER_A,
      draft: { ...apiKeyDraft('sk-o'), provider: EAuthProvider.OpenAI },
    })

    expect(await accounts()).toHaveLength(3)
  })

  it('add still allows several oauth accounts for one provider', async () => {
    await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })
    await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-2')) })

    expect(await accounts()).toHaveLength(2)
  })
})
