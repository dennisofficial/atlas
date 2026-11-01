import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'

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

  it('reconciles an unprocessed row, incrementing attempts until it processes', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-3', event: 'pull_request', payload: { n: 1 } })

    let calls = 0
    await service.handleReconcile({
      process: async () => {
        calls += 1
        if (calls === 1) throw new Error('transient')
        return { handled: true }
      },
    })

    let row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-3' }).first()
    expect(row?.attempts).toBe(2)
    expect(row?.processedAt).toBeNull()
    expect(row?.processingError).toContain('transient')

    await service.handleReconcile({
      process: async () => {
        calls += 1
        return { handled: true }
      },
    })

    row = await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-3' }).first()
    expect(row?.attempts).toBe(3)
    expect(row?.processedAt).not.toBeNull()
    expect(row?.processingError).toBeNull()
    expect(calls).toBe(2)
  })

  it('stops retrying a row past ten attempts and leaves it for alerting', async () => {
    const service = inbox()
    await service.insert({ deliveryId: 'd-4', event: 'ping', payload: {} })
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-4' }).updateAndCount({
      attempts: 10,
    })

    let calls = 0
    await service.handleReconcile({
      process: async () => {
        calls += 1
        return { handled: true }
      },
    })

    expect(calls).toBe(0)
  })
})
