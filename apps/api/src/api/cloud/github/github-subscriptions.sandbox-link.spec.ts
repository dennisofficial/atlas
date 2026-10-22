import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  ensureUsers,
  repoHookRows,
  seedCloudSandbox,
  seedPrState,
  seedRepoHook,
  seedSubscription,
  subscriptionRows,
} from '../../../../test/github-seed'
import { serviceWith } from './github-subscriptions.fixture'

describe('sandbox link and park survival', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1', 'usr_2')
  })

  const expiredRow = (overrides: Partial<Row<'GithubSubscription'>> = {}) =>
    seedSubscription({
      id: 'sub-parked',
      userId: 'usr_1',
      branch: '',
      expiresAt: new Date(Date.now() - 60_000),
      liveUntil: new Date(Date.now() - 60_000),
      ...overrides,
    })

  const sandboxRow = (overrides: Partial<Parameters<typeof seedCloudSandbox>[0]> = {}) =>
    seedCloudSandbox({
      id: 'sbx_row_1',
      threadId: 'thr_1',
      userId: 'usr_1',
      sandboxId: 'sbx_1',
      name: 'atlas-thr_1',
      state: 'parked',
      lastActivityAt: new Date(),
      ...overrides,
    })

  it('subscribe with a sandbox principal records the thread link', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await sandboxRow()

    await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_1',
    })

    expect((await subscriptionRows())[0]).toMatchObject({ threadId: 'thr_1' })
  })

  it('subscribe without a sandbox principal leaves the link null', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    expect((await subscriptionRows())[0]).toMatchObject({ threadId: null })
  })

  it('re-subscribing from a different sandbox re-points the link', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await sandboxRow()
    await sandboxRow({ id: 'sbx_row_2', threadId: 'thr_2', sandboxId: 'sbx_2' })
    await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_1',
    })

    await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_2',
    })

    expect(await subscriptionRows()).toHaveLength(1)
    expect((await subscriptionRows())[0]).toMatchObject({ threadId: 'thr_2' })
  })

  it('heartbeat from a sandbox re-points the link', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await sandboxRow()
    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })

    await service.heartbeat({
      userId: 'usr_1',
      subscriptionId: dto.id,
      threadId: 'thr_1',
    })

    expect((await subscriptionRows())[0]).toMatchObject({ threadId: 'thr_1' })
  })

  it('an expired subscription whose liveUntil covers the wake window still counts as live', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await sandboxRow()
    await expiredRow({
      threadId: 'thr_1',
      liveUntil: new Date(Date.now() + 23 * 60 * 60 * 1_000),
    })
    await seedPrState({
      checksPassed: 3,
      mergeable: true,
      updatedAt: new Date('2026-09-28T00:00:00.000Z'),
    })

    const live = await service.liveSubscriptions({ userId: 'usr_1' })
    const states = await service.currentStates({ userId: 'usr_1' })

    expect(live).toHaveLength(1)
    expect(states).toHaveLength(1)
    expect(states[0]?.prNumber).toBe(42)
  })

  it('an expired subscription whose sandbox fell out of the wake window is dead', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await sandboxRow({ lastActivityAt: new Date(Date.now() - 25 * 60 * 60 * 1_000) })
    await expiredRow({ threadId: 'thr_1' })

    expect(await service.liveSubscriptions({ userId: 'usr_1' })).toHaveLength(0)
    expect(await service.currentStates({ userId: 'usr_1' })).toHaveLength(0)
  })

  it('an expired subscription with a threadId but no sandbox row is dead', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await sandboxRow({ threadId: 'thr_gone' })
    await expiredRow({ threadId: 'thr_gone' })
    await db.orm.public.CloudSandbox.where({ threadId: 'thr_gone' }).deleteAndCount()

    expect(await service.liveSubscriptions({ userId: 'usr_1' })).toHaveLength(0)
  })

  it('a parked-linked subscription keeps its repo hook out of the idle drain', async () => {
    const service = serviceWith({ token: 'ghu_1' })
    await sandboxRow()
    await expiredRow({
      threadId: 'thr_1',
      liveUntil: new Date(Date.now() + 23 * 60 * 60 * 1_000),
    })
    await seedRepoHook({ createdBy: 'usr_1' })

    await service.markIdleWhenDrained({ repoFullName: 'compai/app' })

    expect((await repoHookRows())[0]?.idleSince).toBeNull()
  })
})
