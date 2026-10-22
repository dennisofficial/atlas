import { ForbiddenException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { ensureUsers, prStateRows, subscriptionRows } from '../../../../test/github-seed'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { serviceWith } from './github-subscriptions.fixture'

describe('GithubSubscriptionsService subscribe', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1', 'usr_2')
  })

  afterEach(() => unstubAllGlobals())

  it('validates access, ensures the hook, upserts the subscription and pulls the current state', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })

    expect(dto.pollBacked).toBe(false)
    expect(await subscriptionRows()).toHaveLength(1)
    expect(await prStateRows()).toHaveLength(1)
    expect(dto.state).toMatchObject({ prNumber: 42, checksPassed: 2, mergeable: true })
    expect(Date.parse(dto.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('resolves a branch to its open pull request and keys the row by branch', async () => {
    const service = serviceWith({ token: 'ghu_1' })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(await subscriptionRows()).toHaveLength(1)
    expect((await subscriptionRows())[0]).toMatchObject({
      prNumber: 42,
      branch: 'dennis/add-the-thing',
    })
    expect(dto.prNumber).toBe(42)
    expect(dto.branch).toBe('dennis/add-the-thing')
    expect(dto.state?.prNumber).toBe(42)
    expect(dto.state?.headBranch).toBe('dennis/add-the-thing')
  })

  it('subscribes a branch with no open pull request yet, returning a null state', async () => {
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: async () => null })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(dto.prNumber).toBeNull()
    expect(dto.branch).toBe('dennis/add-the-thing')
    expect(dto.state).toBeNull()
    expect(await subscriptionRows()).toHaveLength(1)
    expect((await subscriptionRows())[0]).toMatchObject({
      prNumber: null,
      branch: 'dennis/add-the-thing',
    })
    expect(await prStateRows()).toHaveLength(0)
  })

  it('a poll-backed branch row with no pull request yet is still recorded', async () => {
    const service = serviceWith({
      token: 'ghu_1',
      ensureHook: 'poll-backed',
      findOpenPrForBranch: async () => null,
    })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(dto.pollBacked).toBe(true)
    expect((await subscriptionRows())[0]).toMatchObject({
      prNumber: null,
      branch: 'dennis/add-the-thing',
      pollBacked: true,
    })
  })

  it('a number subscribe for a pr the api will not find is still a 404 path', async () => {
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: async () => null })

    await expect(
      service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', branch: 'no/such' }),
    ).resolves.toMatchObject({ prNumber: null, branch: 'no/such' })
    expect(await subscriptionRows()).toHaveLength(1)
  })

  it('re-subscribing a branch with an open PR after subscribing before it updates the row', async () => {
    const finds = vi
      .fn<() => Promise<{ number: number } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ number: 42 })
    const service = serviceWith({ token: 'ghu_1', findOpenPrForBranch: finds })

    const first = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })
    const second = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(await subscriptionRows()).toHaveLength(1)
    expect(second.id).toBe(first.id)
    expect(second.prNumber).toBe(42)
    expect(second.state?.prNumber).toBe(42)
  })

  it('marks the subscription poll-backed when the hook cannot be created', async () => {
    const service = serviceWith({ token: 'ghu_1', ensureHook: 'poll-backed' })

    const dto = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })

    expect(dto.pollBacked).toBe(true)
    expect(dto.state?.prNumber).toBe(42)
  })

  it('re-subscribing refreshes the expiry instead of duplicating the row', async () => {
    const service = serviceWith({ token: 'ghu_1', ensureHook: 'existing' })

    const first = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
    const second = await service.subscribe({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })

    expect(await subscriptionRows()).toHaveLength(1)
    expect(second.id).toBe(first.id)
  })

  it('stores a number subscribe under the #<prNumber> sentinel branch so number rows never collide', async () => {
    const service = serviceWith({ token: 'ghu_1', ensureHook: 'existing' })

    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 })
    await service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 87 })

    const branches = (await subscriptionRows()).map((row) => row.branch).sort()
    expect(branches).toEqual(['#42', '#87'])
  })

  it('refuses a repo the user cannot read on github', async () => {
    const denied = async () => new Response('{}', { status: 404 })
    const service = serviceWith({ token: 'ghu_1', fetchImpl: denied as unknown as typeof fetch })

    await expect(
      service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(await subscriptionRows()).toHaveLength(0)
  })

  it('refuses callers who never connected github', async () => {
    const service = serviceWith({})

    await expect(
      service.subscribe({ userId: 'usr_1', repoFullName: 'compai/app', prNumber: 42 }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
