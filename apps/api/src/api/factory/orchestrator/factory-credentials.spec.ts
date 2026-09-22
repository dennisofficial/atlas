import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb, uniqueViolation } from '../../../../test/fake-factory-db.js'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { EAuthKind } from '../../platform/accounts/accounts.types'
import {
  FactoryCredentialsNotConfigured,
  FactoryCredentialService,
} from './factory-credentials'

const cipher = {
  encrypt: (plain: string) => `sealed:${plain}`,
} as unknown as SecretCipherService

function fakeEnv(args: { provider?: string; apiKey?: string }): EnvService {
  return {
    get: (key: string) => {
      if (key === 'FACTORY_MODEL_PROVIDER') return args.provider
      if (key === 'FACTORY_MODEL_API_KEY') return args.apiKey
      return undefined
    },
  } as unknown as EnvService
}

describe('FactoryCredentialService', () => {
  const fake = fakeFactoryDb()

  beforeEach(() => {
    fake.reset()
  })

  it('seals the env api key into an account and points the provider at it', async () => {
    const service = new FactoryCredentialService(fakeEnv({ apiKey: 'sk-factory' }), cipher)

    await service.ensureSeeded({ userId: 'usr_factory' })

    expect(fake.agentAccounts).toHaveLength(1)
    const account = fake.agentAccounts[0]
    expect(account).toMatchObject({
      provider: 'anthropic',
      kind: EAuthKind.ApiKey,
      origin: 'environment',
      status: 'active',
      userId: 'usr_factory',
    })
    expect(account?.sealedSecret).toBe(`sealed:${JSON.stringify({ kind: EAuthKind.ApiKey, apiKey: 'sk-factory' })}`)
    expect(fake.activeAccounts).toEqual([
      { userId: 'usr_factory', provider: 'anthropic', accountId: account?.id ?? '' },
    ])
  })

  it('honors FACTORY_MODEL_PROVIDER when the orchestrator runs on another provider', async () => {
    const service = new FactoryCredentialService(
      fakeEnv({ provider: 'openrouter', apiKey: 'sk-or' }),
      cipher,
    )

    await service.ensureSeeded({ userId: 'usr_factory' })

    expect(fake.agentAccounts[0]?.provider).toBe('openrouter')
    expect(fake.activeAccounts[0]?.provider).toBe('openrouter')
  })

  it('is a no-op once the provider already has an active account', async () => {
    const service = new FactoryCredentialService(fakeEnv({ apiKey: 'sk-factory' }), cipher)
    await service.ensureSeeded({ userId: 'usr_factory' })
    await service.ensureSeeded({ userId: 'usr_factory' })

    expect(fake.agentAccounts).toHaveLength(1)
  })

  it('a seeding race keeps the winner and cleans up the loser account', async () => {
    const service = new FactoryCredentialService(fakeEnv({ apiKey: 'sk-factory' }), cipher)
    fake.activeAccounts.push({ userId: 'usr_factory', provider: 'anthropic', accountId: 'acc_won' })
    const findUnique = fake.db.activeAccount.findUnique.bind(fake.db.activeAccount)
    fake.db.activeAccount.findUnique = (async () => null) as typeof findUnique

    await service.ensureSeeded({ userId: 'usr_factory' })

    expect(fake.activeAccounts).toHaveLength(1)
    expect(fake.activeAccounts[0]?.accountId).toBe('acc_won')
    expect(fake.agentAccounts).toHaveLength(0)
    fake.db.activeAccount.findUnique = findUnique
  })

  it('fails loudly when the tier carries no model key', async () => {
    const service = new FactoryCredentialService(fakeEnv({}), cipher)

    await expect(service.ensureSeeded({ userId: 'usr_factory' })).rejects.toBeInstanceOf(
      FactoryCredentialsNotConfigured,
    )
    expect(fake.agentAccounts).toHaveLength(0)

    await expect(service.ensureSeeded({ userId: 'usr_factory' })).rejects.toBeInstanceOf(
      FactoryCredentialsNotConfigured,
    )
  })

  it('does not cache a failure: a later wake retries seeding', async () => {
    let apiKey: string | undefined
    const env = {
      get: (key: string) => (key === 'FACTORY_MODEL_API_KEY' ? apiKey : undefined),
    } as unknown as EnvService
    const service = new FactoryCredentialService(env, cipher)

    await expect(service.ensureSeeded({ userId: 'usr_factory' })).rejects.toBeInstanceOf(
      FactoryCredentialsNotConfigured,
    )
    apiKey = 'sk-arrived'
    await service.ensureSeeded({ userId: 'usr_factory' })
    expect(fake.agentAccounts).toHaveLength(1)
  })

  it('tolerates the pointer unique violation shape the driver adapter emits', () => {
    expect(uniqueViolation(['userId', 'provider']).code).toBe('P2002')
  })
})
