import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  ensureUsers,
  repoHookRows,
  seedPrState,
  seedRepoHook,
  seedSubscription,
  subscriptionRows,
} from '../../../../test/github-seed'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { serviceWith } from './github-subscriptions.fixture'

describe('GithubSubscriptionsService heartbeat, unsubscribe and current states', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1', 'usr_2')
  })

  afterEach(() => unstubAllGlobals())

  it('heartbeat works on a branch row with no pull request yet', async () => {
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: async () => null })
    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })
    await db.orm.public.GithubSubscription.where({ id: dto.id }).update({
      expiresAt: new Date(Date.now() - 60_000),
    })

    const beat = await service.heartbeat({ userId: 'usr_1', subscriptionId: dto.id })

    expect(Date.parse(beat.expiresAt)).toBeGreaterThan(Date.now() + 4 * 60_000)
  })

  it('heartbeat pushes the expiry out five minutes', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
    await db.orm.public.GithubSubscription.where({ id: dto.id }).update({
      expiresAt: new Date(Date.now() - 60_000),
    })

    const beat = await service.heartbeat({ userId: 'usr_1', subscriptionId: dto.id })

    expect(Date.parse(beat.expiresAt)).toBeGreaterThan(Date.now() + 4 * 60_000)
  })

  it('heartbeat on a subscription owned by someone else 404s', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })

    await expect(
      service.heartbeat({ userId: 'usr_2', subscriptionId: dto.id }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('unsubscribe removes the row and marks the repo idle when nothing live remains', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
    await seedRepoHook({ createdBy: 'usr_1' })

    await service.unsubscribe({ userId: 'usr_1', subscriptionId: dto.id })

    expect(await subscriptionRows()).toHaveLength(0)
    expect((await repoHookRows())[0]?.idleSince).not.toBeNull()
  })

  it('unsubscribe keeps the repo active while another subscription is live', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
    await seedSubscription({ id: 'sub-other', userId: 'usr_2', prNumber: 7 })
    await seedRepoHook({ createdBy: 'usr_1' })

    await service.unsubscribe({ userId: 'usr_1', subscriptionId: dto.id })

    expect((await repoHookRows())[0]?.idleSince).toBeNull()
  })

  it('unsubscribe of a missing row 404s', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    await expect(
      service.unsubscribe({ userId: 'usr_1', subscriptionId: 'sub-nope' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('currentStates returns the cached state for every live subscription with a pr number', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    const past = new Date(Date.now() - 60_000)
    await seedSubscription({ id: 'sub-1', userId: 'usr_1', prNumber: 42, branch: '#42' })
    await seedSubscription({
      id: 'sub-2',
      userId: 'usr_1',
      prNumber: null,
      branch: 'dennis/fresh-branch',
    })
    await seedSubscription({
      id: 'sub-3',
      userId: 'usr_1',
      prNumber: 7,
      branch: '#7',
      expiresAt: past,
      liveUntil: past,
    })
    await seedSubscription({ id: 'sub-4', userId: 'usr_2', prNumber: 99, branch: '#99' })
    await seedPrState({
      checksPassed: 3,
      checksFailed: 0,
      mergeable: true,
      updatedAt: new Date('2026-09-28T00:00:00.000Z'),
    })

    const states = await service.currentStates({ userId: 'usr_1' })

    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({
      repoFullName: 'compai/app',
      prNumber: 42,
      checksPassed: 3,
      updatedAt: '2026-09-28T00:00:00.000Z',
    })
  })
})
