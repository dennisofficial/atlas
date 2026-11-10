import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { db, sharedPool } from '@dltech/atlas-db'
import { GithubDeliveryFillDeferred } from './github-delivery-fill'
import {
  DEFERRED_MAX_AGE_MS,
  GithubWebhookInboxService,
  INLINE_LEASE_MS,
  MAX_ATTEMPTS,
  retryDelayMs,
} from './github-webhook-inbox.service'

const inbox = () => new GithubWebhookInboxService()

describe('GithubWebhookInboxService', () => {
  useTestDatabase()

  it('inserts a delivery once and treats a redelivery as a no-op', async () => {
    const service = inbox()
    const payload = { zen: 'hi' }

    expect(await service.insert({ deliveryId: 'd-1', event: 'ping', payload })).toBe(true)
    expect(await service.insert({ deliveryId: 'd-1', event: 'ping', payload })).toBe(false)

    const rows = await db.orm.public.GithubWebhookInbox.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ deliveryId: 'd-1', event: 'ping', attempts: 1 })
  })

  it('accepts exactly one of two simultaneous inserts of the same delivery id', async () => {
    const service = inbox()

    for (let round = 0; round < 12; round += 1) {
      const deliveryId = `race-${round}`
      const results = await Promise.all([
        service.insert({ deliveryId, event: 'check_run', payload: { copy: 'app' } }),
        service.insert({ deliveryId, event: 'check_run', payload: { copy: 'hook' } }),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      const rows = await db.orm.public.GithubWebhookInbox.where({ deliveryId }).all()
      expect(rows).toHaveLength(1)
    }
  })

  it('marks a row processed and skips it on reconcile', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-2', event: 'ping', payload: {} })
    await service.markProcessed({ deliveryId: 'd-2' })

    const processed: unknown[] = []
    await service.handleReconcile({
      process: async (entry) => {
        processed.push(entry)
        return { handled: true }
      },
    })

    expect(processed).toHaveLength(0)
    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-2' }).first()
    expect(row?.processedAt).not.toBeNull()
  })

  it('inserts a row already leased to the inline handler', async () => {
    const before = Date.now()
    await inbox().insert({ deliveryId: 'd-lease', event: 'ping', payload: {} })

    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-lease' }).first()
    expect(row?.attempts).toBe(1)
    expect(row?.leaseUntil?.getTime()).toBeGreaterThanOrEqual(before + INLINE_LEASE_MS)
  })

  it('does not reconcile a row an inline handler still holds', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-held', event: 'ping', payload: {} })

    const processed: unknown[] = []
    await service.handleReconcile({
      process: async (entry) => {
        processed.push(entry)
      },
    })

    expect(processed).toHaveLength(0)
    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-held' }).first()
    expect(row?.attempts).toBe(1)
    expect(row?.processedAt).toBeNull()
  })

  it('reconciles a row once its lease has expired and counts the attempt at claim', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-3', event: 'pull_request', payload: { n: 1 } })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-3' }).updateAndCount({
      leaseUntil: new Date(Date.now() - 1000),
    })

    const seenAttempts: number[] = []
    await service.handleReconcile({
      process: async (entry) => {
        const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-3' }).first()
        seenAttempts.push(row?.attempts ?? -1)
        expect(entry).toEqual({ event: 'pull_request', payload: { n: 1 } })
      },
    })

    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-3' }).first()
    expect(seenAttempts).toEqual([2])
    expect(row?.processedAt).not.toBeNull()
    expect(row?.processingError).toBeNull()
    expect(row?.leaseUntil).toBeNull()
  })

  it('lets only one of two simultaneous reconciles claim a due row', async () => {
    await inbox().insert({ deliveryId: 'd-race', event: 'ping', payload: {} })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-race' }).updateAndCount({
      leaseUntil: null,
    })

    let calls = 0
    const process = async () => {
      calls += 1
      await Bun.sleep(50)
    }
    await Promise.all([inbox().handleReconcile({ process }), inbox().handleReconcile({ process })])

    expect(calls).toBe(1)
  })

  it('schedules exponential backoff after a failed reconcile and skips the row until due', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-backoff', event: 'ping', payload: {} })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-backoff' }).updateAndCount({
      leaseUntil: null,
    })

    const before = Date.now()
    await service.handleReconcile({
      process: async () => {
        throw new Error('transient')
      },
    })

    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-backoff' }).first()
    expect(row?.attempts).toBe(2)
    expect(row?.processingError).toContain('transient')
    expect(row?.leaseUntil).toBeNull()
    expect(row?.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(before + retryDelayMs(2))

    let calls = 0
    await service.handleReconcile({
      process: async () => {
        calls += 1
      },
    })
    expect(calls).toBe(0)
  })

  it('doubles the retry delay from one minute and caps it at an hour', () => {
    expect(retryDelayMs(1)).toBe(60_000)
    expect(retryDelayMs(2)).toBe(120_000)
    expect(retryDelayMs(4)).toBe(480_000)
    expect(retryDelayMs(MAX_ATTEMPTS)).toBe(3_600_000)
  })

  it('records an inline failure with a backoff instead of leaving the lease to expire', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-inline', event: 'ping', payload: {} })
    await service.markFailed({ deliveryId: 'd-inline', error: new Error('boom') })

    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-inline' }).first()
    expect(row?.processingError).toContain('boom')
    expect(row?.leaseUntil).toBeNull()
    expect(row?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now())
  })

  it('marks a row dead when its final attempt fails, and never reconciles it again', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-4', event: 'ping', payload: {} })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-4' }).updateAndCount({
      attempts: MAX_ATTEMPTS - 1,
      leaseUntil: null,
    })

    await service.handleReconcile({
      process: async () => {
        throw new Error('still broken')
      },
    })

    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-4' }).first()
    expect(row?.attempts).toBe(MAX_ATTEMPTS)
    expect(row?.deadAt).not.toBeNull()
    expect(row?.processedAt).toBeNull()
    expect(row?.processingError).toContain('still broken')

    let calls = 0
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-4' }).updateAndCount({
      nextAttemptAt: null,
    })
    await service.handleReconcile({
      process: async () => {
        calls += 1
      },
    })
    expect(calls).toBe(0)
  })

  it('marks a row dead without processing it when attempts ran out on an expired lease', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-crashed', event: 'ping', payload: {} })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-crashed' }).updateAndCount({
      attempts: MAX_ATTEMPTS,
      leaseUntil: new Date(Date.now() - 1000),
    })

    let calls = 0
    await service.handleReconcile({
      process: async () => {
        calls += 1
      },
    })

    const row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-crashed' }).first()
    expect(calls).toBe(0)
    expect(row?.deadAt).not.toBeNull()
  })

  it('retries a budget-deferred delivery past the attempt cap and still settles it', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-deferred', event: 'check_run', payload: { n: 1 } })
    const deferred = () =>
      new GithubDeliveryFillDeferred({ repoFullName: 'compai/app', prNumbers: [888] })

    for (let round = 0; round < MAX_ATTEMPTS + 6; round += 1) {
      await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-deferred' }).updateAndCount({
        leaseUntil: null,
        nextAttemptAt: null,
      })
      await service.handleReconcile({
        process: async () => {
          throw deferred()
        },
      })
    }

    let row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-deferred' }).first()
    expect(row?.deadAt).toBeNull()
    expect(row?.processedAt).toBeNull()
    expect(row?.attempts).toBeLessThan(MAX_ATTEMPTS)
    expect(row?.processingError).toContain('deferred')

    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-deferred' }).updateAndCount({
      leaseUntil: null,
      nextAttemptAt: null,
    })
    await service.handleReconcile({ process: async () => undefined })

    row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-deferred' }).first()
    expect(row?.processedAt).not.toBeNull()
  })

  it('gives up on a delivery the budget deferred past its age ceiling', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-deferred-old', event: 'check_run', payload: {} })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-deferred-old' }).updateAndCount({
      receivedAt: new Date(Date.now() - DEFERRED_MAX_AGE_MS - 1_000),
      leaseUntil: null,
      nextAttemptAt: null,
    })

    await service.handleReconcile({
      process: async () => {
        throw new GithubDeliveryFillDeferred({ repoFullName: 'compai/app', prNumbers: [888] })
      },
    })

    const row = await db.orm.public.GithubWebhookInbox.where({
      deliveryId: 'd-deferred-old',
    }).first()
    expect(row?.deadAt).not.toBeNull()
  })

  it('holds no open transaction while the handler runs', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-tx', event: 'ping', payload: {} })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-tx' }).updateAndCount({
      leaseUntil: null,
    })

    let openTransactions = -1
    await service.handleReconcile({
      process: async () => {
        const result = await sharedPool().query(
          "SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'",
        )
        openTransactions = (result.rows[0] as { open: number }).open
      },
    })

    expect(openTransactions).toBe(0)
  })
})
