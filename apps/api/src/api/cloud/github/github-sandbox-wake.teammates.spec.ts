import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedThreadRow } from '../../../../test/session-seed'
import {
  ESeededSubscription,
  fakeBoot,
  flushDebounce,
  PR_EVENT,
  seedParkedSandbox,
  seedSubscription,
  seedThreadSubscription,
  serviceWith,
  useWakeFixture,
} from '../../../../test/github-sandbox-wake-fixture'
import { EPrEventKind } from './github-realtime.types'
import type { WakePrEvent } from './github-sandbox-wake-intent'

const VERDICT: WakePrEvent = {
  userId: 'usr-1',
  repoFullName: 'compai/app',
  prNumber: 42,
  kind: EPrEventKind.Verdict,
  payload: {
    url: 'https://github.com/compai/app/pull/42',
    verdict: 'green',
    headSha: 'abc123',
    settled: true,
  },
}

async function seedAgentThread(args: { id: string; spawnedBy: string; type: string }) {
  await seedThreadRow({
    id: args.id,
    userId: 'usr-1',
    spawnerThreadId: args.spawnedBy,
    agentType: args.type,
    managedBySessionId: `ses_${args.spawnedBy}`,
  })
}

describe('GithubSandboxWakeService teammate subscriptions', () => {
  useTestDatabase()
  useWakeFixture()

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

  it('a teammate-owned link wakes the teammate thread with the intent on the teammate thread', async () => {
    await seedParkedSandbox()
    await seedAgentThread({ id: 'mate-1', spawnedBy: 'thr-1', type: 'teammate' })
    await seedSubscription({ threadId: 'mate-1' })
    const { boot, calls } = fakeBoot()

    serviceWith({ boot }).notifyEvent(PR_EVENT, VERDICT)
    await flushDebounce()

    expect(calls.map((call) => call.threadId)).toEqual(['mate-1'])
    const intents = await db.orm.public.Event.where({ threadId: 'mate-1', type: 'pr-event' }).all()
    expect(intents).toHaveLength(1)
    const body = JSON.parse(intents[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.kind).toBe('verdict')
    expect(body.subscriptionId).toBe('sub-1')
    expect(
      await db.orm.public.Event.where({ threadId: 'thr-1', type: 'pr-event' }).all(),
    ).toHaveLength(0)
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
