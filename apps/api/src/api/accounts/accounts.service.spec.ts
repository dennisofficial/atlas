import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '@core/config/env/env.service'
import { SecretCipherService } from '@lib/crypto/secret-cipher.service'
import type { PrismaClient } from '../../generated/prisma/client'
import type { CreateAccountDto, SecretDto } from './accounts.dto'
import { AccountsService } from './accounts.service'
import { EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider } from './accounts.types'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

interface AgentAccountRow {
  id: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email: string | null
  subscription: string | null
  importedFrom: string | null
  sealedSecret: string
  createdAt: Date
  updatedAt: Date
  userId: string
}

interface ActiveAccountRow {
  userId: string
  provider: string
  accountId: string
  createdAt: Date
  updatedAt: Date
}

const fake = vi.hoisted(() => {
  const accounts: AgentAccountRow[] = []
  const actives: ActiveAccountRow[] = []

  const db = {
    agentAccount: {
      findMany: async (args: { where: { userId: string } }) =>
        accounts.filter((row) => row.userId === args.where.userId),
      findFirst: async (args: { where: { id: string; userId: string } }) =>
        accounts.find(
          (row) => row.id === args.where.id && row.userId === args.where.userId,
        ) ?? null,
      create: async (args: { data: Omit<AgentAccountRow, 'createdAt' | 'updatedAt'> }) => {
        const row = { ...args.data, createdAt: new Date(), updatedAt: new Date() }
        accounts.push(row)
        return row
      },
      update: async (args: {
        where: { id: string }
        data: Partial<Pick<AgentAccountRow, 'sealedSecret' | 'kind' | 'status'>>
      }) => {
        const row = accounts.find((candidate) => candidate.id === args.where.id)
        if (!row) throw new Error('record not found')
        Object.assign(row, args.data, { updatedAt: new Date() })
        return row
      },
      delete: async (args: { where: { id: string } }) => {
        const row = accounts.find((candidate) => candidate.id === args.where.id)
        if (!row) throw new Error('record not found')
        accounts.splice(accounts.indexOf(row), 1)
        return row
      },
    },
    activeAccount: {
      findUnique: async (args: {
        where: { userId_provider: { userId: string; provider: string } }
      }) =>
        actives.find(
          (row) =>
            row.userId === args.where.userId_provider.userId &&
            row.provider === args.where.userId_provider.provider,
        ) ?? null,
      create: async (args: {
        data: Omit<ActiveAccountRow, 'createdAt' | 'updatedAt'>
      }) => {
        const row = { ...args.data, createdAt: new Date(), updatedAt: new Date() }
        actives.push(row)
        return row
      },
      upsert: async (args: {
        where: { userId_provider: { userId: string; provider: string } }
        create: Omit<ActiveAccountRow, 'createdAt' | 'updatedAt'>
        update: { accountId: string }
      }) => {
        const existing = actives.find(
          (row) =>
            row.userId === args.where.userId_provider.userId &&
            row.provider === args.where.userId_provider.provider,
        )
        if (existing) {
          existing.accountId = args.update.accountId
          existing.updatedAt = new Date()
          return existing
        }
        const row = { ...args.create, createdAt: new Date(), updatedAt: new Date() }
        actives.push(row)
        return row
      },
      deleteMany: async (args: { where: { userId: string; accountId: string } }) => {
        const kept = actives.filter(
          (row) => !(row.userId === args.where.userId && row.accountId === args.where.accountId),
        )
        const count = actives.length - kept.length
        actives.splice(0, actives.length, ...kept)
        return { count }
      },
    },
  }

  return { db, accounts, actives }
})

vi.mock('@db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER_A = 'user-a'
const USER_B = 'user-b'

function oauthSecret(accessToken: string): SecretDto {
  return {
    kind: EAuthKind.Oauth,
    tokens: {
      accessToken,
      refreshToken: 'refresh-token',
      expiresAt: '2026-10-01T00:00:00.000Z',
    },
  }
}

function draftOf(secret: SecretDto): CreateAccountDto {
  return {
    provider: EAuthProvider.Anthropic,
    label: 'Claude subscription',
    origin: EAccountOrigin.Login,
    secret,
  }
}

describe('AccountsService', () => {
  let service: AccountsService

  beforeEach(() => {
    fake.accounts.length = 0
    fake.actives.length = 0
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

    expect(fake.actives).toHaveLength(1)
    expect(fake.actives[0]?.accountId).toBe(first.id)
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

  it('replaceSecret reseals and flips an expired account back to active', async () => {
    const account = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })
    await service.setStatus({
      userId: USER_A,
      accountId: account.id,
      status: { status: EAccountStatus.Expired },
    })
    const sealedBefore = fake.accounts[0]?.sealedSecret

    await service.replaceSecret({
      userId: USER_A,
      accountId: account.id,
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-ant-new' },
    })

    const stored = await service.read({ userId: USER_A, accountId: account.id })
    expect(stored.status).toBe(EAccountStatus.Active)
    expect(stored.kind).toBe(EAuthKind.ApiKey)
    expect(stored.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-ant-new' })
    expect(fake.accounts[0]?.sealedSecret).not.toBe(sealedBefore)
    expect(fake.accounts[0]?.sealedSecret).not.toContain('sk-ant-new')
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

    await expect(
      service.remove({ userId: USER_B, accountId: account.id }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(fake.accounts).toHaveLength(1)
  })

  it('setActive upserts the per-provider pointer', async () => {
    const first = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-1')) })
    const second = await service.add({ userId: USER_A, draft: draftOf(oauthSecret('at-2')) })

    await service.setActive({
      userId: USER_A,
      draft: { provider: EAuthProvider.Anthropic, accountId: second.id },
    })

    expect(fake.actives).toHaveLength(1)
    expect(await service.activeFor({ userId: USER_A, provider: 'anthropic' })).toEqual({
      accountId: second.id,
    })
    expect(fake.actives[0]?.accountId).not.toBe(first.id)
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
    expect(fake.accounts).toHaveLength(0)
  })
})
