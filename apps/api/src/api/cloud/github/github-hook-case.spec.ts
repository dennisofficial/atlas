import { createHmac, randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { seedRepoHook } from '../../../../test/github-seed'
import { GithubHookController } from './github-hook.controller'
import { PULL_REQUEST_PAYLOAD } from './github-delivery.fixture'
import { mockGithubHttp, realObservationGraph } from './github-observation-http.fixture'
import type { GithubPrWebhookRequest } from './github-webhook.types'

describe('legacy mixed-case hook identity', () => {
  useTestDatabase()
  it('reconciles the existing legacy row and receives a signed delivery with the updated secret', async () => {
    const redis = await createRealRedisService()
    const http = mockGithubHttp()
    http.allowHooks()
    const graph = realObservationGraph({
      redis,
      prefix: `test:hook-case:${randomUUID()}:`,
      tokens: { 'usr-owner': 'owner' },
      appBacked: false,
    })
    try {
      await seedRepoHook({ repoFullName: 'CompAI/App', createdBy: 'usr-owner', status: 'orphaned' })
      await graph.hooks.ensureHook({ userId: 'usr-owner', repoFullName: 'COMPAI/APP' })
      const hook = await db.orm.public.GithubRepoHook.first({ repoFullName: 'CompAI/App' })
      if (hook === null) throw new Error('legacy hook row missing')
      expect(hook.hookId).toBe(123n)
      expect(hook.secret).not.toBe('sealed:secret')
      expect(await db.orm.public.GithubRepoHook.all()).toHaveLength(1)
      const rawBody = Buffer.from(JSON.stringify(PULL_REQUEST_PAYLOAD))
      const signature = `sha256=${createHmac('sha256', hook.secret).update(rawBody).digest('hex')}`
      const controller = new GithubHookController(graph.delivery, graph.cipher)
      expect(
        await controller.handleDelivery(
          { rawBody } as GithubPrWebhookRequest,
          'compai/app',
          signature,
          'pull_request',
          'application/json',
        ),
      ).toEqual({ received: true })
      expect(
        await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 42 }),
      ).not.toBeNull()
    } finally {
      await graph.fanout.onModuleDestroy()
      await redis.onModuleDestroy()
      http.restore()
    }
  })
})
