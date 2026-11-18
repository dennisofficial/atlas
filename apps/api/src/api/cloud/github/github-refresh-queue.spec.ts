import { Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ensureUsers, seedSubscription } from '../../../../test/github-seed'
import type { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { LOOKUPS_PER_SWEEP, refreshGithubQueue } from './github-refresh-queue'
import { localCoordinator } from './github-request-coordinator.fixture'
import type { TransportSelector } from './github-transport-selector'

const COVERED_REPO = 'compai/covered'

const seedHead = (index: number, overrides: Record<string, unknown> = {}) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: COVERED_REPO,
    branch: `dennis/head-${index}`,
    prNumber: 0,
    lookedUpAt: null,
    liveUntil: new Date(Date.now() + 3_600_000),
    ...overrides,
  })

const queueDeps = (args: {
  lookUp: () => Promise<'looked-up' | 'rate-limited'>
  refresh: () => Promise<'polled'>
}) => ({
  coordinator: localCoordinator(),
  hooks: { ensureHook: async () => 'poll-backed' } as unknown as GithubHookLifecycleService,
  transport: {
    polls: async (repo: string) => repo !== COVERED_REPO,
  } as unknown as TransportSelector,
  logger: new Logger('refresh-queue-spec'),
  resolve: async () => null,
  refresh: args.refresh,
  lookUp: args.lookUp,
})

describe('refreshGithubQueue budget reservation', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1')
  })

  it('spends at most its slice of the minute on seeding heads', async () => {
    const lookUp = vi.fn(async () => 'looked-up' as const)
    const refresh = vi.fn(async () => 'polled' as const)
    for (let index = 0; index < LOOKUPS_PER_SWEEP * 5; index += 1) await seedHead(index)

    await refreshGithubQueue(queueDeps({ lookUp, refresh }))

    expect(lookUp).toHaveBeenCalledTimes(LOOKUPS_PER_SWEEP)
  })

  it('refreshes a known pull request even when the lookup phase is refused the budget', async () => {
    const lookUp = vi.fn(async () => 'rate-limited' as const)
    const refresh = vi.fn(async () => 'polled' as const)
    await seedHead(0)
    await seedSubscription({ prNumber: 42, branch: '#42', pollBacked: true })

    await refreshGithubQueue(queueDeps({ lookUp, refresh }))

    expect(refresh).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
  })
})
