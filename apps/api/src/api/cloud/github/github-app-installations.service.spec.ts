import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { ensureUsers } from '../../../../test/github-seed'
import { GithubAppInstallationsService } from './github-app-installations.service'
import type { GithubAppInstallationWebhookPayload } from './github-webhook.types'

const service = new GithubAppInstallationsService()
const HOUR_MS = 60 * 60 * 1_000

const seedTarget = (args: { repoFullName: string; nextDueAt: Date }) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: args.repoFullName,
    branch: 'dennis/feature',
    prNumber: 0,
    lookedUpAt: null,
    attemptedAt: null,
    failures: 0,
    leaseUntil: null,
    nextDueAt: args.nextDueAt,
    liveUntil: new Date(args.nextDueAt.getTime() + HOUR_MS),
  })

const dueAt = (id: string) => db.orm.public.GithubTrackingTarget.first({ id })

function installationPayload(overrides: {
  action?: string
  id?: number
  suspended?: boolean
  repos?: string[]
}): GithubAppInstallationWebhookPayload {
  return {
    action: overrides.action ?? 'created',
    installation: {
      id: overrides.id ?? 1001,
      account: { login: 'trycompai', type: 'Organization' },
      suspended_at: overrides.suspended === true ? '2026-10-14T00:00:00Z' : null,
    },
    repositories: (overrides.repos ?? ['trycompai/comp-v2']).map((full_name) => ({ full_name })),
  }
}

describe('GithubAppInstallationsService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('covers a repo after a created installation and stops covering it on delete', async () => {
    await service.applyInstallation(installationPayload({}))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(true)
    expect(await service.coversRepo({ repoFullName: 'trycompai/other' })).toBe(false)

    await service.applyInstallation(installationPayload({ action: 'deleted' }))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)
  })

  it('a suspended installation covers nothing until unsuspended', async () => {
    await service.applyInstallation(installationPayload({ suspended: true }))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)

    await service.applyInstallation(installationPayload({ action: 'unsuspend', suspended: false }))
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(true)
  })

  it('installation_repositories adds and removes repos from the held set', async () => {
    await service.applyInstallation(installationPayload({ repos: ['trycompai/comp-v2'] }))
    await service.applyRepositories({
      action: 'added',
      installation: {
        id: 1001,
        account: { login: 'trycompai', type: 'Organization' },
        suspended_at: null,
      },
      repositories_added: [{ full_name: 'trycompai/comp-v3' }],
    })
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v3' })).toBe(true)

    await service.applyRepositories({
      action: 'removed',
      installation: {
        id: 1001,
        account: { login: 'trycompai', type: 'Organization' },
        suspended_at: null,
      },
      repositories_removed: [{ full_name: 'trycompai/comp-v2' }],
    })
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v3' })).toBe(true)
  })

  it('makes the targets of a repo removed from an installation due for the next sweep', async () => {
    await service.applyInstallation(installationPayload({ repos: ['trycompai/comp-v2'] }))
    const target = await seedTarget({
      repoFullName: 'trycompai/comp-v2',
      nextDueAt: new Date(Date.now() + HOUR_MS),
    })

    await service.applyRepositories({
      action: 'removed',
      installation: {
        id: 1001,
        account: { login: 'trycompai', type: 'Organization' },
        suspended_at: null,
      },
      repositories_removed: [{ full_name: 'trycompai/comp-v2' }],
    })

    expect((await dueAt(target.id))?.nextDueAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('makes the targets of every repo a deleted installation covered due', async () => {
    await service.applyInstallation(
      installationPayload({ repos: ['trycompai/comp-v2', 'trycompai/comp-v3'] }),
    )
    const kept = await seedTarget({
      repoFullName: 'trycompai/comp-v3',
      nextDueAt: new Date(Date.now() + HOUR_MS),
    })
    const untouched = await seedTarget({
      repoFullName: 'trycompai/unrelated',
      nextDueAt: new Date(Date.now() + HOUR_MS),
    })

    await service.applyInstallation(installationPayload({ action: 'deleted' }))

    expect((await dueAt(kept.id))?.nextDueAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect((await dueAt(untouched.id))?.nextDueAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('ignores an installation event that carries no repositories list', async () => {
    const { repositories: _omitted, ...withoutRepos } = installationPayload({})
    await service.applyInstallation(withoutRepos)
    expect(await service.coversRepo({ repoFullName: 'trycompai/comp-v2' })).toBe(false)
  })
})
