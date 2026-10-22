import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ensureUsers, repoHookRows, seedRepoHook } from '../../../../test/github-seed'
import type { EnvService } from '../../../_core/config/env/env.service'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubHookLifecycleService, HOOK_EVENTS } from './github-hook-lifecycle.service'
import type { CreateHookResult, GithubUserReads } from './github-user-reads'
import type { GithubService } from './github.service'

const CIPHER = { encrypt: (plain: string) => `sealed:${plain}`, decrypt: () => 'secret' } as unknown as SecretCipherService
const ENV = { get: (key: string) => (key === 'BETTER_AUTH_URL' ? 'https://api.byatlas.io' : undefined) } as unknown as EnvService

function serviceWith(args: {
  tokens?: Record<string, string>
  createHook?: (call: { repo: string }) => Promise<CreateHookResult>
  deleteHook?: () => Promise<'deleted' | 'unauthorized'>
  getHook?: () => Promise<'found' | 'missing' | 'unauthorized'>
  getHookEvents?: () => Promise<string[]>
  coversRepo?: () => Promise<boolean>
}): {
  service: GithubHookLifecycleService
  created: string[]
  deleted: string[]
  verified: string[]
  updated: string[][]
} {
  const created: string[] = []
  const deleted: string[] = []
  const verified: string[] = []
  const updated: string[][] = []
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
    getHook: async (call: { repo: string }) => {
      verified.push(call.repo)
      return (args.getHook ?? (async () => 'found' as const))()
    },
    getHookEvents: args.getHookEvents ?? (async () => [...HOOK_EVENTS]),
    updateHook: async (call: { events: string[] }) => {
      updated.push(call.events)
    },
  } as unknown as GithubUserReads
  const installations = {
    coversRepo: args.coversRepo ?? (async () => false),
  } as unknown as GithubAppInstallationsService
  return {
    service: new GithubHookLifecycleService(github, reads, CIPHER, ENV, installations),
    created,
    deleted,
    verified,
    updated,
  }
}

const seedHook = (overrides: Parameters<typeof seedRepoHook>[0] = {}) => seedRepoHook(overrides)

describe('GithubHookLifecycleService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1', 'usr_2', 'usr-creator')
  })
  it('creates the hook as the subscribing user on the first subscription for a repo', async () => {
    const { service, created } = serviceWith({ tokens: { 'usr_1': 'ghu_1' } })

    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('created')
    expect(created).toEqual(['app'])
    expect(await repoHookRows()).toHaveLength(1)
    expect((await repoHookRows())[0]).toMatchObject({
      repoFullName: 'compai/app',
      hookId: 555n,
      createdBy: 'usr_1',
      status: 'active',
    })
    expect((await repoHookRows())[0]?.secret.startsWith('sealed:')).toBe(true)
  })

  it('reuses the existing hook row on later subscribes when github still has it', async () => {
    const { service, created, verified } = serviceWith({ tokens: { 'usr_2': 'ghu_2' } })
    await seedHook()

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect(created).toHaveLength(0)
    expect(verified).toEqual(['app'])
  })

  it('recreates the hook when github no longer has it', async () => {
    const { service, created } = serviceWith({
      tokens: { 'usr_2': 'ghu_2' },
      getHook: async () => 'missing',
    })
    await seedHook()

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('created')
    expect(created).toEqual(['app'])
    expect((await repoHookRows())[0]).toMatchObject({
      hookId: 555n,
      createdBy: 'usr_2',
      status: 'active',
    })
  })

  it('patches the hook event list on verify when it has drifted', async () => {
    const { service, created, updated } = serviceWith({
      tokens: { 'usr_2': 'ghu_2' },
      getHookEvents: async () => ['pull_request', 'check_suite', 'check_run', 'push'],
    })
    await seedHook()

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect(created).toHaveLength(0)
    expect(updated).toEqual([[...HOOK_EVENTS]])
  })

  it('does not patch the hook when the event list already covers every event', async () => {
    const { service, updated } = serviceWith({
      tokens: { 'usr_2': 'ghu_2' },
      getHookEvents: async () => [...HOOK_EVENTS],
    })
    await seedHook()

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect(updated).toHaveLength(0)
  })

  it('trusts the row when the verify token cannot read the hook', async () => {
    const { service, created } = serviceWith({
      tokens: { 'usr_2': 'ghu_2' },
      getHook: async () => 'unauthorized',
    })
    await seedHook()

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect(created).toHaveLength(0)
  })

  it('trusts the row when the verify call fails outright', async () => {
    const { service, created } = serviceWith({
      tokens: { 'usr_2': 'ghu_2' },
      getHook: async () => {
        throw new Error('github is down')
      },
    })
    await seedHook()

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect(created).toHaveLength(0)
  })

  it('memoizes the verify for a few minutes instead of hammering github on every resubscribe', async () => {
    const { service, verified } = serviceWith({ tokens: { 'usr_2': 'ghu_2' } })
    await seedHook()

    await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })
    await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(verified).toEqual(['app'])
  })

  it('adopts a hook github already has (422) instead of failing', async () => {
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      createHook: async () => ({ outcome: 'adopted', hookId: 777 }),
    })

    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
    expect((await repoHookRows())[0]?.hookId).toBe(777n)
  })

  it('reports poll-backed when github forbids hook creation', async () => {
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      createHook: async () => ({ outcome: 'forbidden' }),
    })

    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('poll-backed')
    expect(await repoHookRows()).toHaveLength(0)
  })

  it('tolerates a concurrent creator who won the row', async () => {
    const { service } = serviceWith({
      tokens: { 'usr_1': 'ghu_1' },
      createHook: async () => {
        await seedHook()
        return { outcome: 'created', hookId: 555 }
      },
    })
    const result = await service.ensureHook({ userId: 'usr_1', repoFullName: 'compai/app' })

    expect(result).toBe('existing')
  })

  it('recreates an orphaned hook with the new subscriber as creator', async () => {
    const { service } = serviceWith({ tokens: { 'usr_2': 'ghu_2' } })
    await seedHook({ status: 'orphaned' })

    const result = await service.ensureHook({ userId: 'usr_2', repoFullName: 'compai/app' })

    expect(result).toBe('created')
    expect((await repoHookRows())[0]).toMatchObject({
      hookId: 555n,
      createdBy: 'usr_2',
      status: 'active',
      idleSince: null,
    })
  })

  it('the sweeper deletes a hook idle for over 24 hours, claimed by lease', async () => {
    const { service, deleted } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    await seedHook({ idleSince: new Date(Date.now() - 25 * 60 * 60 * 1_000) })

    await service.handleSweep()

    expect(deleted).toHaveLength(1)
    expect(await repoHookRows()).toHaveLength(0)
  })

  it('the sweeper leaves a hook alone while it still has life', async () => {
    const { service, deleted } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    await seedHook({ idleSince: new Date(Date.now() - 1 * 60 * 60 * 1_000) })

    await service.handleSweep()

    expect(deleted).toHaveLength(0)
    expect(await repoHookRows()).toHaveLength(1)
  })

  it('the sweeper marks the hook orphaned when the creator token is dead', async () => {
    const { service, deleted } = serviceWith({ tokens: {} })
    await seedHook({ idleSince: new Date(Date.now() - 25 * 60 * 60 * 1_000) })

    await service.handleSweep()

    expect(deleted).toHaveLength(0)
    expect((await repoHookRows())[0]?.status).toBe('orphaned')
  })

  it('a second sweeper cannot claim a hook already leased', async () => {
    const { service, deleted } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    await seedHook({
      idleSince: new Date(Date.now() - 25 * 60 * 60 * 1_000),
      sweepLeaseUntil: new Date(Date.now() + 60_000),
    })

    await service.handleSweep()

    expect(deleted).toHaveLength(0)
    expect((await repoHookRows())[0]?.status).toBe('active')
  })
})
