import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { CreateHookResult, GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

const fake = fakeGithubDb()

const CIPHER = { encrypt: (plain: string) => `sealed:${plain}`, decrypt: () => 'secret' } as unknown as SecretCipherService
const ENV = { get: (key: string) => (key === 'BETTER_AUTH_URL' ? 'https://api.byatlas.io' : undefined) } as unknown as EnvService

function serviceWith(args: {
  tokens?: Record<string, string>
  createHook?: (call: { repo: string }) => Promise<CreateHookResult>
  deleteHook?: () => Promise<'deleted' | 'unauthorized'>
}): { service: GithubHookLifecycleService; created: string[]; deleted: string[] } {
  const created: string[] = []
  const deleted: string[] = []
  const github = {
    findToken: async ({ userId }: { userId: string }) => args.tokens?.[userId],
  } as unknown as GithubService
  const reads = {
    createHook: async (call: { repo: string }) => {
      created.push(call.repo)
      return (args.createHook ?? (async () => ({ outcome: 'created', hookId: 555 }) as CreateHookResult))({
        repo: call.repo,
      })
    },
    deleteHook: async () => {
      deleted.push('deleted')
      return (args.deleteHook ?? (async () => 'deleted' as const))()
    },
  } as unknown as GithubUserReads
  return { service: new GithubHookLifecycleService(github, reads, CIPHER, ENV), created, deleted }
}

function seedHook(overrides: Partial<(typeof fake.repoHooks)[number]> = {}): void {
  fake.repoHooks.push({
    repoFullName: 'compai/app',
    hookId: 101n,
    secret: 'sealed:secret',
    createdBy: 'usr-creator',
    status: 'active',
    idleSince: null,
    sweepLeaseUntil: null,
    createdAt: new Date(),
    ...overrides,
  })
}

describe('GithubHookLifecycleService', () => {
  beforeEach(() => fake.reset())

  it('creates the hook as the subscribing user on the first subscription for a repo', async () => {
    const { service, created } = serviceWith({ tokens: { 'usr_1': 'ghu_1' } })

    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('created')
    expect(created).toEqual(['app'])
    expect(fake.repoHooks).toHaveLength(1)
    expect(fake.repoHooks[0]).toMatchObject({
      repoFullName: 'compai/app',
      hookId: 555n,
      createdBy: 'usr_1',
      status: 'active',
    })
    expect(fake.repoHooks[0]?.secret.startsWith('sealed:')).toBe(true)
  })

  it('reuses the existing hook row on later subscribes', async () => {
    const { service, created } = serviceWith({ tokens: { 'usr_2': 'ghu_2' } })
    seedHook()

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect(created).toHaveLength(0)
  })

  it('adopts a hook github already has (422) instead of failing', async () => {
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      createHook: async () => ({ outcome: 'adopted', hookId: 777 }),
    })

    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect(fake.repoHooks[0]?.hookId).toBe(777n)
  })

  it('reports poll-backed when github forbids hook creation', async () => {
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      createHook: async () => ({ outcome: 'forbidden' }),
    })

    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('poll-backed')
    expect(fake.repoHooks).toHaveLength(0)
  })

  it('tolerates a concurrent creator who won the row', async () => {
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      createHook: async () => ({ outcome: 'created', hookId: 555 }),
    })
    const { uniqueViolation } = await import('../../../../test/fake-db-support.js')
    fake.db.githubRepoHook.create = (async () => {
      seedHook()
      throw uniqueViolation(['repoFullName'])
    }) as unknown as typeof fake.db.githubRepoHook.create

    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
  })

  it('recreates an orphaned hook with the new subscriber as creator', async () => {
    const { service } = serviceWith({ tokens: { 'usr_2': 'ghu_2' } })
    seedHook({ status: 'orphaned' })

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('created')
    expect(fake.repoHooks[0]).toMatchObject({
      hookId: 555n,
      createdBy: 'usr_2',
      status: 'active',
      idleSince: null,
    })
  })

  it('the sweeper deletes a hook idle for over 24 hours, claimed by lease', async () => {
    const { service, deleted } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    seedHook({ idleSince: new Date(Date.now() - 25 * 60 * 60 * 1_000) })

    await service.handleSweep()

    expect(deleted).toHaveLength(1)
    expect(fake.repoHooks).toHaveLength(0)
  })

  it('the sweeper leaves a hook alone while it still has life', async () => {
    const { service, deleted } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    seedHook({ idleSince: new Date(Date.now() - 1 * 60 * 60 * 1_000) })

    await service.handleSweep()

    expect(deleted).toHaveLength(0)
    expect(fake.repoHooks).toHaveLength(1)
  })

  it('the sweeper marks the hook orphaned when the creator token is dead', async () => {
    const { service, deleted } = serviceWith({ tokens: {} })
    seedHook({ idleSince: new Date(Date.now() - 25 * 60 * 60 * 1_000) })

    await service.handleSweep()

    expect(deleted).toHaveLength(0)
    expect(fake.repoHooks[0]?.status).toBe('orphaned')
  })

  it('a second sweeper cannot claim a hook already leased', async () => {
    const { service, deleted } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    seedHook({
      idleSince: new Date(Date.now() - 25 * 60 * 60 * 1_000),
      sweepLeaseUntil: new Date(Date.now() + 60_000),
    })

    await service.handleSweep()

    expect(deleted).toHaveLength(0)
    expect(fake.repoHooks[0]?.status).toBe('active')
  })
})
