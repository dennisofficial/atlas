import { describe, expect, it, vi } from 'bun:test'
import { GithubConfig } from './github-config'
import type { GithubRedis, GithubSecretCipher } from './github-ports'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { buildGithubSweeps } from './github-sweeps'

const cipher: GithubSecretCipher = {
  encrypt: (plain) => plain,
  decrypt: (blob) => blob,
}

const noRedis: GithubRedis = {
  isConfigured: () => false,
  client: () => {
    throw new Error('no redis in this spec')
  },
  duplicate: () => {
    throw new Error('no redis in this spec')
  },
}

const build = () => buildGithubSweeps({ config: new GithubConfig({}), cipher, redis: noRedis })

describe('buildGithubSweeps', () => {
  it('builds every sweep over the config, the cipher and the redis port', () => {
    const sweeps = build()

    expect(sweeps.pollSweeper.handlePoll).toBeFunction()
    expect(sweeps.hookSweep.handleSweep).toBeFunction()
    expect(sweeps.webhookInbox.handleReconcile).toBeFunction()
    expect(sweeps.deliveries.handle).toBeFunction()
    expect(sweeps.outbox.drain).toBeFunction()
    expect(sweeps.store.apply).toBeFunction()
    expect(sweeps.fanout).toBeInstanceOf(GithubPrFanoutService)
  })

  it('tears the fan-out down on dispose', async () => {
    const destroy = vi.spyOn(GithubPrFanoutService.prototype, 'onModuleDestroy')
    const sweeps = build()
    try {
      await sweeps.dispose()

      expect(destroy).toHaveBeenCalledTimes(1)
    } finally {
      destroy.mockRestore()
    }
  })
})
