import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../_core/config/env/env.service'
import { GithubHookLifecycleService } from '../../api/cloud/github/github-hook-lifecycle.service'
import { GithubPollSweeperService } from '../../api/cloud/github/github-poll-sweeper.service'
import { GithubPrFanoutService } from '../../api/cloud/github/github-pr-fanout.service'
import { GithubSandboxWakeService } from '../../api/cloud/github/github-sandbox-wake.service'
import { buildGithubSweepGraph } from './github-sweep-graph'

const SECRETS_ENCRYPTION_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

function envWith(values: Record<string, string>): EnvService {
  return new EnvService({ SECRETS_ENCRYPTION_KEY, ...values })
}

describe('buildGithubSweepGraph', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs both sweep services from a fake env without touching the database', async () => {
    const graph = buildGithubSweepGraph({ env: envWith({}) })

    expect(graph.pollSweeper).toBeInstanceOf(GithubPollSweeperService)
    expect(graph.hookLifecycle).toBeInstanceOf(GithubHookLifecycleService)
    await graph.dispose()
  })

  it('binds a publishing redis bus when the env carries REDIS_URL, without opening a connection', async () => {
    const graph = buildGithubSweepGraph({ env: envWith({ REDIS_URL: 'rediss://localhost:6380' }) })

    expect(graph.pollSweeper).toBeInstanceOf(GithubPollSweeperService)
    await expect(graph.dispose()).resolves.toBeUndefined()
  })

  it('refuses a secrets key that does not decode to 32 bytes', () => {
    expect(() =>
      buildGithubSweepGraph({ env: envWith({ SECRETS_ENCRYPTION_KEY: 'short' }) }),
    ).toThrow(/32 bytes/)
  })

  it('settles pending wake boots before it tears the fan-out down', async () => {
    const order: string[] = []
    vi.spyOn(GithubSandboxWakeService.prototype, 'settle').mockImplementation(async () => {
      order.push('settle')
    })
    vi.spyOn(GithubPrFanoutService.prototype, 'onModuleDestroy').mockImplementation(async () => {
      order.push('fanout-destroy')
    })
    const graph = buildGithubSweepGraph({ env: envWith({}) })

    await graph.dispose()

    expect(order).toEqual(['settle', 'fanout-destroy'])
  })
})
