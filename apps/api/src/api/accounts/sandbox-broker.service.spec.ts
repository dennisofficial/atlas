import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import type { PrismaClient } from '../../generated/prisma/client'
import { SecretsService } from '../secrets/secrets.service'
import { AccountsService } from './accounts.service'
import { EAuthKind } from './accounts.types'
import { BrokerService } from './broker.service'
import { SandboxBrokerService } from './sandbox-broker.service'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

const USER_A = 'user-a'
const USER_B = 'user-b'

interface AccountRow {
  id: string
  userId: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email: string | null
  subscription: string | null
  importedFrom: string | null
  sealedSecret: string
  secretVersion: number
  createdAt: Date
  updatedAt: Date
}

interface SecretRow {
  id: string
  userId: string
  name: string
  sealedValue: string
  createdAt: Date
  updatedAt: Date
}

const fake = vi.hoisted(() => {
  const accounts: AccountRow[] = []
  const pointers: { userId: string; provider: string; accountId: string }[] = []
  const secrets: SecretRow[] = []

  const db = {
    agentAccount: {
      findFirst: async (args: { where: { id: string; userId: string } }) =>
        accounts.find(
          (row) => row.id === args.where.id && row.userId === args.where.userId,
        ) ?? null,
      findMany: async (args: { where: { userId: string }; orderBy?: unknown }) =>
        accounts.filter((row) => row.userId === args.where.userId),
      updateMany: async (args: {
        where: { id: string; secretVersion: number }
        data: { sealedSecret: string; secretVersion: number }
      }) => {
        const row = accounts.find(
          (one) => one.id === args.where.id && one.secretVersion === args.where.secretVersion,
        )
        if (row === undefined) return { count: 0 }
        row.sealedSecret = args.data.sealedSecret
        row.secretVersion = args.data.secretVersion
        return { count: 1 }
      },
    },
    activeAccount: {
      findUnique: async (args: { where: { userId_provider: { userId: string; provider: string } } }) =>
        pointers.find(
          (row) =>
            row.userId === args.where.userId_provider.userId &&
            row.provider === args.where.userId_provider.provider,
        ) ?? null,
      findMany: async (args: { where: { userId: string }; select?: unknown }) =>
        pointers
          .filter((row) => row.userId === args.where.userId)
          .map((row) => ({ provider: row.provider, accountId: row.accountId })),
    },
    secretEntry: {
      findMany: async (args: { where: { userId: string; name?: { in: string[] } } }) =>
        secrets.filter(
          (row) =>
            row.userId === args.where.userId &&
            (args.where.name === undefined || args.where.name.in.includes(row.name)),
        ),
    },
  }

  return { db, accounts, pointers, secrets }
})

vi.mock('../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const cipher = () => new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))

describe('SandboxBrokerService', () => {
  let service: SandboxBrokerService
  let seal: (value: unknown) => string

  const addAccount = (partial: Partial<AccountRow> & { id: string; secret: unknown }): AccountRow => {
    const row: AccountRow = {
      userId: USER_A,
      provider: 'anthropic',
      kind: EAuthKind.Oauth,
      origin: 'login',
      label: 'work',
      status: 'active',
      email: null,
      subscription: null,
      importedFrom: null,
      secretVersion: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...partial,
      sealedSecret: seal(partial.secret),
    }
    fake.accounts.push(row)
    return row
  }

  beforeEach(() => {
    fake.accounts.length = 0
    fake.pointers.length = 0
    fake.secrets.length = 0
    const c = cipher()
    seal = (value) => c.encrypt(JSON.stringify(value))
    service = new SandboxBrokerService(
      new AccountsService(c),
      new BrokerService(c),
      new SecretsService(c),
      c,
    )
  })

  it('answers account metadata and active pointers without any secret material', async () => {
    addAccount({
      id: 'acc_1',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: '2099-01-01T00:00:00.000Z' },
      },
    })
    fake.pointers.push({ userId: USER_A, provider: 'anthropic', accountId: 'acc_1' })

    const body = await service.listAccounts({ userId: USER_A })

    expect(body.accounts).toHaveLength(1)
    expect(body.active).toEqual([{ provider: 'anthropic', accountId: 'acc_1' }])
    expect(JSON.stringify(body)).not.toContain('rt-1')
    expect(JSON.stringify(body)).not.toContain('at-1')
  })

  it('mints an api-key credential for the provider’s active account', async () => {
    addAccount({ id: 'acc_key', kind: EAuthKind.ApiKey, secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-live' } })
    fake.pointers.push({ userId: USER_A, provider: 'anthropic', accountId: 'acc_key' })

    const token = await service.accessToken({ userId: USER_A, provider: 'anthropic' })

    expect(token).toEqual({
      accountId: 'acc_key',
      kind: EAuthKind.ApiKey,
      accessToken: 'sk-live',
      expiresAt: null,
    })
  })

  it('mints an oauth access token with its provider account id, never the refresh token', async () => {
    addAccount({
      id: 'acc_oauth',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: 'at-live',
          refreshToken: 'rt-secret',
          expiresAt: '2099-01-01T00:00:00.000Z',
          accountId: 'provider-1',
        },
      },
    })
    fake.pointers.push({ userId: USER_A, provider: 'anthropic', accountId: 'acc_oauth' })

    const token = await service.accessToken({ userId: USER_A, provider: 'anthropic' })

    expect(token).toMatchObject({
      accountId: 'acc_oauth',
      kind: EAuthKind.Oauth,
      accessToken: 'at-live',
      providerAccountId: 'provider-1',
    })
    expect(JSON.stringify(token)).not.toContain('rt-secret')
  })

  it('refuses to mint for a provider with no active account', async () => {
    await expect(service.accessToken({ userId: USER_A, provider: 'openai' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('never mints against another user’s account', async () => {
    addAccount({
      id: 'acc_theirs',
      userId: USER_B,
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-theirs' },
    })

    await expect(
      service.accessToken({ userId: USER_A, provider: 'anthropic', accountId: 'acc_theirs' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers only the requested secrets, decrypted', async () => {
    const c = cipher()
    fake.secrets.push(
      {
        id: 'sec_1',
        userId: USER_A,
        name: 'search.tavily',
        sealedValue: c.encrypt(JSON.stringify('tvly-1')),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'sec_2',
        userId: USER_A,
        name: 'other.key',
        sealedValue: c.encrypt(JSON.stringify('other-value')),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    )

    const found = await service.namedSecrets({ userId: USER_A, names: ['search.tavily', 'absent.key'] })

    expect(found.map((row) => row.name)).toEqual(['search.tavily'])
    expect(found[0]?.value).toBe('tvly-1')
  })
})
