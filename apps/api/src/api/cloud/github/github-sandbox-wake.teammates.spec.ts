import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  ESeededSubscription,
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  seedParkedSandbox,
  seedSubscription,
  seedThreadSubscription,
  serviceWith,
} from '../../../../test/github-sandbox-wake-fixture'

async function seedAgentThread(args: { id: string; spawnedBy: string; type: string }) {
  const at = new Date()
  await db.orm.public.Thread.create({
    id: args.id,
    userId: 'usr-1',
    createdAt: at,
    updatedAt: at,
    spawnerThreadId: args.spawnedBy,
    agentType: args.type,
  })
}

describe('GithubSandboxWakeService teammate subscriptions', () => {
  useTestDatabase()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    unstubAllGlobals()
    vi.useRealTimers()
  })

  it('wakes the sandbox when only a teammate of its thread holds the subscription', async () => {
    await seedParkedSandbox()
    await seedSubscription({ subscription: ESeededSubscription.Absent })
    await seedAgentThread({ id: 'mate-1', spawnedBy: 'thr-1', type: 'teammate' })
    await seedThreadSubscription({ threadId: 'mate-1', status: ESeededSubscription.Active })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls.map((call) => call.threadId)).toEqual(['thr-1'])
  })

  it('does not wake for a non-teammate agent thread holding the subscription', async () => {
    await seedParkedSandbox()
    await seedSubscription({ subscription: ESeededSubscription.Absent })
    await seedAgentThread({ id: 'explorer-1', spawnedBy: 'thr-1', type: 'explore' })
    await seedThreadSubscription({ threadId: 'explorer-1', status: ESeededSubscription.Active })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })

  it('does not wake when the teammate subscription is paused', async () => {
    await seedParkedSandbox()
    await seedSubscription({ subscription: ESeededSubscription.Absent })
    await seedAgentThread({ id: 'mate-1', spawnedBy: 'thr-1', type: 'teammate' })
    await seedThreadSubscription({ threadId: 'mate-1', status: ESeededSubscription.Paused })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT)
    await flushDebounce()

    expect(calls).toHaveLength(0)
  })
})
