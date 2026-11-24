import 'reflect-metadata'
import type { INestApplicationContext } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterEach, describe, expect, it, jest } from 'bun:test'
import {
  GithubDeliveryService,
  GithubHookSweepService,
  GithubPollSweeperService,
  GithubPrOutboxDispatcher,
  GithubWebhookInboxService,
} from '@dltech/atlas-github'
import { EnvService } from '../../../_core/config/env/env.service'
import { GithubSweepSchedulerService } from './github-sweep-scheduler'

afterEach(() => {
  jest.useRealTimers()
})

async function bootScheduler(args: {
  sweeps: string | undefined
  calls: string[]
  failPoll?: boolean
}): Promise<INestApplicationContext> {
  const record = (name: string) => async (): Promise<void> => {
    args.calls.push(name)
    if (name === 'poll' && args.failPoll === true) throw new Error('poll failed')
  }
  const module = await Test.createTestingModule({
    providers: [
      GithubSweepSchedulerService,
      {
        provide: EnvService,
        useValue: new EnvService({ GITHUB_SWEEPS_IN_PROCESS: args.sweeps }),
      },
      { provide: GithubPollSweeperService, useValue: { handlePoll: record('poll') } },
      { provide: GithubHookSweepService, useValue: { handleSweep: record('hook-sweep') } },
      { provide: GithubWebhookInboxService, useValue: { handleReconcile: record('reconcile') } },
      { provide: GithubDeliveryService, useValue: {} },
      {
        provide: GithubPrOutboxDispatcher,
        useValue: { drain: record('drain'), prune: record('prune') },
      },
    ],
  }).compile()
  module.useLogger(false)
  return module.init()
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms)
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
}

describe('github sweep scheduler timers', () => {
  it('ticks the poll every 30 s and the hook sweep and reconcile every 60 s when opted in', async () => {
    jest.useFakeTimers()
    const calls: string[] = []
    const app = await bootScheduler({ sweeps: '1', calls })

    await advance(30_000)
    expect(calls).toEqual(['poll'])

    calls.length = 0
    await advance(30_000)
    expect([...calls].sort()).toEqual(['drain', 'hook-sweep', 'poll', 'prune', 'reconcile'])

    await app.close()
  })

  it('starts no timer when the flag is absent or not 1', async () => {
    jest.useFakeTimers()
    for (const sweeps of [undefined, '0', 'true']) {
      const calls: string[] = []
      const app = await bootScheduler({ sweeps, calls })

      await advance(120_000)

      expect(calls, String(sweeps)).toEqual([])
      await app.close()
    }
  })

  it('stops ticking once the app closes', async () => {
    jest.useFakeTimers()
    const calls: string[] = []
    const app = await bootScheduler({ sweeps: '1', calls })
    await app.close()

    await advance(120_000)

    expect(calls).toEqual([])
  })

  it('keeps ticking after a sweep throws', async () => {
    jest.useFakeTimers()
    const calls: string[] = []
    const app = await bootScheduler({ sweeps: '1', calls, failPoll: true })

    await advance(30_000)
    await advance(30_000)

    expect(calls.filter((call) => call === 'poll')).toEqual(['poll', 'poll'])
    await app.close()
  })
})

describe('github sweep scheduler ticks', () => {
  it('runs only the poll sweep on each poll tick', async () => {
    const calls: string[] = []
    const scheduler = new GithubSweepSchedulerService(
      { handlePoll: async () => void calls.push('poll') } as never,
      { handleSweep: async () => void calls.push('hook-sweep') } as never,
      {} as never,
      {} as never,
      {} as never,
      new EnvService({}),
    )

    await scheduler.handlePollTick()

    expect(calls).toEqual(['poll'])
  })

  it('drains and prunes the pr outbox on each webhook reconcile tick', async () => {
    const calls: string[] = []
    const scheduler = new GithubSweepSchedulerService(
      {} as never,
      {} as never,
      { handleReconcile: async () => void calls.push('reconcile') } as never,
      {} as never,
      {
        drain: async () => void calls.push('drain'),
        prune: async () => void calls.push('prune'),
      } as never,
      new EnvService({}),
    )

    await scheduler.handleWebhookReconcileTick()

    expect(calls).toEqual(['reconcile', 'drain', 'prune'])
  })
})
