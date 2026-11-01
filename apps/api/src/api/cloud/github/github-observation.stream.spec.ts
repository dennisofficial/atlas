import { randomUUID } from 'node:crypto'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import { Logger } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { seedPrState } from '../../../../test/github-seed'
import { waitFor } from '../../../../test/fake-timers'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { seedLinkedPr } from './github-linked-pr.fixture'
import { attachObservedStates } from './github-observation.stream'
import { mockGithubHttp, realObservationGraph } from './github-observation-http.fixture'
import { OBSERVATION_RENEW_MS } from './github-observation.types'
import { fakeSubscriptions } from './github-pr-stream.fixture'
import type { GithubSubscriptionsService } from './github-subscriptions.service'

describe('observation stream coordinator diagnostics and renewal', () => {
  useTestDatabase()
  let redis: RedisService
  beforeAll(async () => {
    redis = await createRealRedisService()
  })
  afterAll(async () => {
    await redis.onModuleDestroy()
  })

  it('replays authorized cache during coordinator outage, stays attached, renews by 45s and clears its diagnostic on recovery', async () => {
    const http = mockGithubHttp()
    const graph = realObservationGraph({
      redis,
      prefix: `test:stream:${randomUUID()}:`,
      tokens: { 'usr-owner': 'owner' },
    })
    await seedLinkedPr()
    await seedPrState()
    await graph.observations.acquire({
      id: 'prime',
      userId: 'usr-owner',
      observe: [{ repo: 'compai/app', number: 42 }],
    })
    const outage = spyOn(redis.client(), 'eval').mockRejectedValue(
      new Error('coordinator unavailable'),
    )
    const frames: GithubPrStatesFrame[] = []
    const intervals = spyOn(globalThis, 'setInterval')
    let closed = false
    const detach = attachObservedStates({
      userId: 'usr-owner',
      observe: [{ repo: 'compai/app', number: 42 }],
      sink: {
        push: (frame) => frames.push(frame),
        close: () => {
          closed = true
        },
      },
      fanout: graph.fanout,
      observations: graph.observations,
      logger: new Logger('observation-test'),
      subscriptions: fakeSubscriptions() as unknown as GithubSubscriptionsService,
    })
    try {
      await waitFor(() =>
        expect(
          frames.some(
            (frame) => frame.type === EGithubPrStatesFrame.ObservationStatus && !frame.available,
          ),
        ).toBe(true),
      )
      await waitFor(() =>
        expect(
          frames.some(
            (frame) => frame.type === EGithubPrStatesFrame.PrState && frame.state.prNumber === 42,
          ),
        ).toBe(true),
      )
      expect(closed).toBe(false)
      outage.mockRestore()
      const renew = intervals.mock.calls.find((call) => call[1] === OBSERVATION_RENEW_MS)?.[0]
      if (typeof renew !== 'function') throw new Error('missing bounded observation renewal')
      renew()
      await waitFor(() =>
        expect(
          frames.some(
            (frame) => frame.type === EGithubPrStatesFrame.ObservationStatus && frame.available,
          ),
        ).toBe(true),
      )
      expect(await graph.observations.owners({ repoFullName: 'compai/app', prNumber: 42 })).toEqual(
        ['usr-owner'],
      )
      expect(http.calls).toHaveLength(1)
    } finally {
      intervals.mockRestore()
      outage.mockRestore()
      detach()
      await graph.observations.release('prime')
      await graph.fanout.onModuleDestroy()
      http.restore()
    }
  })
})
