import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FactoryConnectionsService } from '../connections/connections.service'
import { DEFAULT_FACTORY_MODEL_REF } from '../factory.types'
import { FactoryIdentityService } from '../orchestrator/factory-identity'
import { openModelCredential } from './org-credential-blobs'
import { OrgSettingsService } from './org-settings.service'

const ORG = 'org_compai'
const KEY_ENV = { SECRETS_ENCRYPTION_KEY: 'a'.repeat(64) }

describe('OrgSettingsService', () => {
  const fake = fakeFactoryDb()

  beforeEach(() => {
    fake.reset()
  })

  function service(env: Record<string, string> = {}): OrgSettingsService {
    const cipher = new SecretCipherService(new EnvService(KEY_ENV))
    return new OrgSettingsService(
      new EnvService(env),
      new FactoryConnectionsService(),
      cipher,
      new FactoryIdentityService(cipher),
    )
  }

  function cipher(): SecretCipherService {
    return new SecretCipherService(new EnvService(KEY_ENV))
  }

  it('reports the model as unconfigured with no org row and no env key', async () => {
    const settings = await service().getSettings({ organizationId: ORG })

    expect(settings.model).toEqual({
      provider: 'anthropic',
      modelRef: DEFAULT_FACTORY_MODEL_REF,
      source: 'unconfigured',
      hasApiKey: false,
    })
    expect(settings.vercel).toEqual({ connected: false })
  })

  it('reports the environment as the source when only env credentials exist', async () => {
    const settings = await service({
      FACTORY_MODEL_PROVIDER: 'openrouter',
      FACTORY_MODEL_ID: 'openrouter/kimi-k2',
      FACTORY_MODEL_API_KEY: 'env-key',
    }).getSettings({ organizationId: ORG })

    expect(settings.model).toEqual({
      provider: 'openrouter',
      modelRef: 'openrouter/kimi-k2',
      source: 'environment',
      hasApiKey: true,
    })
  })

  it('lets an org row win over the environment', async () => {
    const settings = service({
      FACTORY_MODEL_PROVIDER: 'openrouter',
      FACTORY_MODEL_API_KEY: 'env-key',
    })
    await settings.putModel({ organizationId: ORG, apiKey: 'org-key', modelRef: 'anthropic/claude-opus' })

    const dto = await settings.getSettings({ organizationId: ORG })
    expect(dto.model).toEqual({
      provider: 'anthropic',
      modelRef: 'anthropic/claude-opus',
      source: 'organization',
      hasApiKey: true,
    })
  })

  it('never exposes a sealed blob or api key in the settings dto', async () => {
    const settings = service()
    await settings.putModel({ organizationId: ORG, apiKey: 'sk-secret-key', modelRef: 'anthropic/claude-opus' })
    await settings.putVercel({ organizationId: ORG, token: 'vercel-secret-token' })

    const serialized = JSON.stringify(await settings.getSettings({ organizationId: ORG }))
    expect(serialized).not.toContain('sk-secret-key')
    expect(serialized).not.toContain('vercel-secret-token')
    expect(serialized).not.toContain(fake.connections[0]?.sealedCredentials ?? 'no-row')
  })

  it('putModel rejects a modelRef that does not look like provider/model', async () => {
    await expect(
      service().putModel({ organizationId: ORG, apiKey: 'key', modelRef: 'no-slash-here' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(fake.connections).toHaveLength(0)
  })

  it('putModel seals the credential so the stored row never contains the api key', async () => {
    await service().putModel({
      organizationId: ORG,
      apiKey: 'sk-live-key',
      modelRef: 'anthropic/claude-opus',
    })

    const row = fake.connections[0]
    expect(row).toMatchObject({
      provider: 'model',
      externalAccountId: ORG,
      organizationId: ORG,
      status: 'active',
    })
    const sealed = row?.sealedCredentials ?? ''
    expect(sealed).not.toBe('')
    expect(sealed).not.toContain('sk-live-key')

    const opened = openModelCredential({ cipher: cipher(), sealed })
    expect(opened).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-live-key',
      modelRef: 'anthropic/claude-opus',
    })
  })

  it('putModel overwrites the key on repeat calls', async () => {
    const settings = service()
    await settings.putModel({ organizationId: ORG, apiKey: 'first-key', modelRef: 'anthropic/claude-opus' })
    await settings.putModel({ organizationId: ORG, apiKey: 'rotated-key', modelRef: 'openai/gpt-5' })

    expect(fake.connections).toHaveLength(1)
    const opened = openModelCredential({
      cipher: cipher(),
      sealed: fake.connections[0]?.sealedCredentials ?? '',
    })
    expect(opened).toEqual({ provider: 'openai', apiKey: 'rotated-key', modelRef: 'openai/gpt-5' })
  })

  it('reports vercel as connected only when a readable vercel row exists', async () => {
    const settings = service()
    expect((await settings.getSettings({ organizationId: ORG })).vercel.connected).toBe(false)

    await settings.putVercel({ organizationId: ORG, token: 'v-token' })
    expect((await settings.getSettings({ organizationId: ORG })).vercel.connected).toBe(true)
  })

  it('readModelCredential returns the sealed blob contents', async () => {
    const settings = service()
    await settings.putModel({ organizationId: ORG, apiKey: 'sk-key', modelRef: 'anthropic/claude-opus' })

    await expect(settings.readModelCredential({ organizationId: ORG })).resolves.toEqual({
      provider: 'anthropic',
      apiKey: 'sk-key',
      modelRef: 'anthropic/claude-opus',
    })
  })

  it('readModelCredential returns null when no row exists', async () => {
    await expect(service().readModelCredential({ organizationId: ORG })).resolves.toBeNull()
  })

  it('readModelCredential returns null for an undecryptable row', async () => {
    fake.connections.push({
      id: 'con_garbage',
      organizationId: ORG,
      provider: 'model',
      externalAccountId: ORG,
      sealedCredentials: 'not-a-sealed-blob',
      scopes: null,
      status: 'active',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    })

    await expect(service().readModelCredential({ organizationId: ORG })).resolves.toBeNull()
    const settings = await service().getSettings({ organizationId: ORG })
    expect(settings.model.source).toBe('unconfigured')
  })

  it('reports decisions as unconfigured until a row is saved', async () => {
    const settings = service()
    expect((await settings.getSettings({ organizationId: ORG })).decisions).toEqual({
      configured: false,
      url: null,
      hasToken: false,
    })

    await settings.putDecisions({ organizationId: ORG, url: 'https://api.typesafe.ai/v1/systemone' })
    expect((await settings.getSettings({ organizationId: ORG })).decisions).toEqual({
      configured: true,
      url: 'https://api.typesafe.ai/v1/systemone',
      hasToken: false,
    })
  })

  it('readDecisionsCredential returns the sealed url and token', async () => {
    const settings = service()
    await settings.putDecisions({
      organizationId: ORG,
      url: 'https://api.typesafe.ai/v1/systemone',
      token: 'jev-key',
    })

    await expect(settings.readDecisionsCredential({ organizationId: ORG })).resolves.toEqual({
      url: 'https://api.typesafe.ai/v1/systemone',
      token: 'jev-key',
    })
    expect((await settings.getSettings({ organizationId: ORG })).decisions.hasToken).toBe(true)
  })

  it('readDecisionsCredential drops an empty token (a self-hosted Laya needs none)', async () => {
    const settings = service()
    await settings.putDecisions({ organizationId: ORG, url: 'http://laya.local', token: '' })

    await expect(settings.readDecisionsCredential({ organizationId: ORG })).resolves.toEqual({
      url: 'http://laya.local',
      token: undefined,
    })
  })

  it('putDecisions seals the token onto the factory identity secret store for the broker', async () => {
    const settings = service()
    await settings.putDecisions({
      organizationId: ORG,
      url: 'https://api.typesafe.ai/v1/systemone',
      token: 'jev-key',
    })

    const cipher = new SecretCipherService(new EnvService(KEY_ENV))
    const entries = fake.secretEntries.filter((one) => one.name === 'decisions.token')
    expect(entries).toHaveLength(1)
    expect(JSON.parse(cipher.decrypt(entries[0]!.sealedValue))).toBe('jev-key')
    // The entry is keyed to the per-org factory identity, which is who a factory sandbox's
    // broker token resolves secrets for.
    const owner = fake.users.find((one) => one.id === entries[0]!.userId)
    expect(owner?.email).toBe(`factory+${ORG}@atlas.internal`)
  })

  it('putDecisions with no token seeds nothing — a self-hosted Laya ignores it', async () => {
    const settings = service()
    await settings.putDecisions({ organizationId: ORG, url: 'http://laya.local' })

    expect(fake.secretEntries).toHaveLength(0)
  })
})
