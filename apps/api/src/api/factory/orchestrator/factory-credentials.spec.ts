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
import { FactoryConnectionsService } from '../connections/connections.service'
import { EFactoryConnectionProvider } from '../factory.types'
import { sealBlob } from '../settings/org-credential-blobs'
import { OrgSettingsService } from '../settings/org-settings.service'
import {
  DEFAULT_FACTORY_MODEL_REF,
  FactoryCredentialsNotConfigured,
  FactoryCredentialService,
} from './factory-credentials'
import { FactoryIdentityService } from './factory-identity'

const cipher = {
  encrypt: (plain: string) => `sealed:${plain}`,
  decrypt: (sealed: string) => {
    if (!sealed.startsWith('sealed:')) throw new Error('bad seal')
    return sealed.slice('sealed:'.length)
  },
} as unknown as SecretCipherService

function fakeEnv(args: { provider?: string; apiKey?: string; modelId?: string }): EnvService {
  return {
    get: (key: string) => {
      if (key === 'FACTORY_MODEL_PROVIDER') return args.provider
      if (key === 'FACTORY_MODEL_API_KEY') return args.apiKey
      if (key === 'FACTORY_MODEL_ID') return args.modelId
      return undefined
    },
  } as unknown as EnvService
}

const service = (env: EnvService) =>
  new FactoryCredentialService(
    env,
    cipher,
    new OrgSettingsService(env, new FactoryConnectionsService(), cipher, new FactoryIdentityService(cipher)),
  )

function storeOrgCredential(args: {
  organizationId: string
  provider: string
  apiKey: string
  modelRef: string
}): void {
  const at = '2026-09-22T00:00:00.000Z'
  fakeFactoryDb().connections.push({
    id: `fcon_${args.organizationId}`,
    organizationId: args.organizationId,
    provider: EFactoryConnectionProvider.Model,
    externalAccountId: args.organizationId,
    sealedCredentials: sealBlob({
      cipher,
      blob: { provider: args.provider, apiKey: args.apiKey, modelRef: args.modelRef },
    }),
    scopes: null,
    status: 'active',
    createdAt: at,
    updatedAt: at,
  })
}

describe('FactoryCredentialService', () => {
  const fake = fakeFactoryDb()

  beforeEach(() => {
    fake.reset()
  })

  it('seals the env api key into an account and points the provider at it', async () => {
    await service(fakeEnv({ apiKey: 'sk-factory' })).ensureSeeded({
      userId: 'usr_factory',
      organizationId: null,
    })

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
    await service(fakeEnv({ provider: 'openrouter', apiKey: 'sk-or' })).ensureSeeded({
      userId: 'usr_factory',
      organizationId: null,
    })

    expect(fake.agentAccounts[0]?.provider).toBe('openrouter')
    expect(fake.activeAccounts[0]?.provider).toBe('openrouter')
  })

  it('is a no-op once the provider already has an active account', async () => {
    const seeded = service(fakeEnv({ apiKey: 'sk-factory' }))
    await seeded.ensureSeeded({ userId: 'usr_factory', organizationId: null })
    await seeded.ensureSeeded({ userId: 'usr_factory', organizationId: null })

    expect(fake.agentAccounts).toHaveLength(1)
  })

  it('a seeding race keeps the winner and cleans up the loser account', async () => {
    const seeded = service(fakeEnv({ apiKey: 'sk-factory' }))
    fake.activeAccounts.push({ userId: 'usr_factory', provider: 'anthropic', accountId: 'acc_won' })
    const findUnique = fake.db.activeAccount.findUnique.bind(fake.db.activeAccount)
    fake.db.activeAccount.findUnique = (async () => null) as typeof findUnique

    await seeded.ensureSeeded({ userId: 'usr_factory', organizationId: null })

    expect(fake.activeAccounts).toHaveLength(1)
    expect(fake.activeAccounts[0]?.accountId).toBe('acc_won')
    expect(fake.agentAccounts).toHaveLength(0)
    fake.db.activeAccount.findUnique = findUnique
  })

  it('fails loudly when the tier carries no model key', async () => {
    const seeded = service(fakeEnv({}))

    await expect(
      seeded.ensureSeeded({ userId: 'usr_factory', organizationId: null }),
    ).rejects.toBeInstanceOf(FactoryCredentialsNotConfigured)
    expect(fake.agentAccounts).toHaveLength(0)

    await expect(
      seeded.ensureSeeded({ userId: 'usr_factory', organizationId: null }),
    ).rejects.toBeInstanceOf(FactoryCredentialsNotConfigured)
  })

  it('does not cache a failure: a later wake retries seeding', async () => {
    let apiKey: string | undefined
    const env = {
      get: (key: string) => (key === 'FACTORY_MODEL_API_KEY' ? apiKey : undefined),
    } as unknown as EnvService
    const seeded = service(env)

    await expect(
      seeded.ensureSeeded({ userId: 'usr_factory', organizationId: null }),
    ).rejects.toBeInstanceOf(FactoryCredentialsNotConfigured)
    apiKey = 'sk-arrived'
    await seeded.ensureSeeded({ userId: 'usr_factory', organizationId: null })
    expect(fake.agentAccounts).toHaveLength(1)
  })

  it('seeds from the org-stored credential instead of the env', async () => {
    storeOrgCredential({
      organizationId: 'org_one',
      provider: 'openrouter',
      apiKey: 'sk-org',
      modelRef: 'openrouter/org-model',
    })

    await service(fakeEnv({})).ensureSeeded({ userId: 'usr_org_one', organizationId: 'org_one' })

    expect(fake.agentAccounts).toHaveLength(1)
    const account = fake.agentAccounts[0]
    expect(account?.provider).toBe('openrouter')
    expect(account?.userId).toBe('usr_org_one')
    expect(account?.sealedSecret).toBe(
      `sealed:${JSON.stringify({ kind: EAuthKind.ApiKey, apiKey: 'sk-org' })}`,
    )
    expect(fake.activeAccounts).toEqual([
      { userId: 'usr_org_one', provider: 'openrouter', accountId: account?.id ?? '' },
    ])
  })

  it('prefers the org credential over the tier env', async () => {
    storeOrgCredential({
      organizationId: 'org_one',
      provider: 'openrouter',
      apiKey: 'sk-org',
      modelRef: 'openrouter/org-model',
    })

    await service(fakeEnv({ provider: 'anthropic', apiKey: 'sk-env' })).ensureSeeded({
      userId: 'usr_org_one',
      organizationId: 'org_one',
    })

    expect(fake.agentAccounts[0]?.provider).toBe('openrouter')
    expect(fake.agentAccounts[0]?.sealedSecret).toContain('sk-org')
    expect(fake.agentAccounts[0]?.sealedSecret).not.toContain('sk-env')
  })

  it('takes the launch model from the org credential, else the env, else the default', async () => {
    storeOrgCredential({
      organizationId: 'org_one',
      provider: 'openrouter',
      apiKey: 'sk-org',
      modelRef: 'openrouter/org-model',
    })
    const seeded = service(fakeEnv({ modelId: 'inference/env-model' }))

    await expect(seeded.modelRef({ organizationId: 'org_one' })).resolves.toBe(
      'openrouter/org-model',
    )
    await expect(seeded.modelRef({ organizationId: null })).resolves.toBe('inference/env-model')
    await expect(service(fakeEnv({})).modelRef({ organizationId: null })).resolves.toBe(
      DEFAULT_FACTORY_MODEL_REF,
    )
  })

  it('rotating the org key replaces the seeded account on the next wake', async () => {
    storeOrgCredential({
      organizationId: 'org_one',
      provider: 'anthropic',
      apiKey: 'sk-old',
      modelRef: 'anthropic/org-model',
    })
    const seeded = service(fakeEnv({}))
    await seeded.ensureSeeded({ userId: 'usr_org_one', organizationId: 'org_one' })
    expect(fake.agentAccounts[0]?.sealedSecret).toContain('sk-old')

    const row = fake.connections[0]
    if (row === undefined) throw new Error('expected the org credential row')
    row.sealedCredentials = sealBlob({
      cipher,
      blob: { provider: 'anthropic', apiKey: 'sk-new', modelRef: 'anthropic/org-model' },
    })
    await seeded.ensureSeeded({ userId: 'usr_org_one', organizationId: 'org_one' })

    expect(fake.agentAccounts).toHaveLength(2)
    const active = fake.activeAccounts[0]
    const replacement = fake.agentAccounts.find((one) => one.id === active?.accountId)
    expect(replacement?.sealedSecret).toContain('sk-new')
    expect(replacement?.sealedSecret).not.toContain('sk-old')
  })

  it('an unchanged org key does not reseed', async () => {
    storeOrgCredential({
      organizationId: 'org_one',
      provider: 'anthropic',
      apiKey: 'sk-org',
      modelRef: 'anthropic/org-model',
    })
    const seeded = service(fakeEnv({}))
    await seeded.ensureSeeded({ userId: 'usr_org_one', organizationId: 'org_one' })
    await seeded.ensureSeeded({ userId: 'usr_org_one', organizationId: 'org_one' })

    expect(fake.agentAccounts).toHaveLength(1)
  })

  it('an org without a stored credential falls back to the env key', async () => {
    const seeded = service(fakeEnv({ apiKey: 'sk-env' }))
    await seeded.ensureSeeded({ userId: 'usr_org_one', organizationId: 'org_one' })
    await seeded.ensureSeeded({ userId: 'usr_org_one', organizationId: 'org_one' })

    expect(fake.agentAccounts).toHaveLength(1)
    expect(fake.agentAccounts[0]?.sealedSecret).toContain('sk-env')
  })

  it('tolerates the pointer unique violation shape the driver adapter emits', () => {
    expect(uniqueViolation(['userId', 'provider']).code).toBe('P2002')
  })
})
