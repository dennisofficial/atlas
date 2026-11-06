import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { prStateRows, seedPrState } from '../../../../test/github-seed'
import {
  SETTLING_CHECK_RUN_PAYLOAD,
  FILLED_PR_STATE,
  prepareDelivery,
  REST_FIELDS,
  seedHook,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'
import { GithubDeliveryFillDeferred } from './github-delivery-fill'
import { GithubHttpBudgetUnavailable } from './github-request-budget'
import { GithubUserReadFailed } from './github-user-reads'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'

const seedTrackedPr = async () => {
  await seedHook({ createdBy: 'usr-creator' })
  await seedSubscription({ userId: 'usr-a', prNumber: 42 })
  await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, checksPassed: 3 })
}

describe('GithubDeliveryService budget-refused fills', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('rejects a settling check delivery whose confirmation read was budget-refused, leaving the row as it was', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: vi.fn(async () => {
        throw new GithubHttpBudgetUnavailable()
      }),
    })
    await seedTrackedPr()

    await expect(
      service.handle({
        event: 'check_run',
        payload: SETTLING_CHECK_RUN_PAYLOAD,
      }),
    ).rejects.toBeInstanceOf(GithubDeliveryFillDeferred)

    expect((await prStateRows())[0]).toMatchObject({
      prNumber: 42,
      checksRunning: 0,
      checksPassed: 3,
    })
  })

  it('still resolves when the fill token is rejected with 404', async () => {
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: vi.fn(async () => {
        throw new GithubUserReadFailed('not found', 404)
      }),
    })
    await seedTrackedPr()

    expect(
      await service.handle({
        event: 'check_run',
        payload: SETTLING_CHECK_RUN_PAYLOAD,
      }),
    ).toEqual({
      handled: true,
    })
  })

  it('a replay confirms with REST and writes its fields', async () => {
    const { service, fanout } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: vi.fn(async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 5,
      })),
    })
    await seedTrackedPr()
    const pushes = vi.spyOn(fanout, 'push')

    await service.handle({
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
      replay: true,
    })

    expect(pushes).toHaveBeenCalledTimes(1)
    expect(pushes.mock.calls[0]?.[0].state).toMatchObject({
      checksRunning: 0,
      checksPassed: 5,
    })
  })

  it('a deferred delivery stays unprocessed and the next reconcile pass settles it', async () => {
    let refuse = true
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: vi.fn(async () => {
        if (refuse) throw new GithubHttpBudgetUnavailable()
        return { ...REST_FIELDS, checksRunning: 0, checksPassed: 4 }
      }),
    })
    await seedTrackedPr()
    const inbox = new GithubWebhookInboxService()
    await inbox.insert({
      deliveryId: 'd-1',
      event: 'check_run',
      payload: SETTLING_CHECK_RUN_PAYLOAD,
    })
    await service
      .handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })
      .catch((error: unknown) => inbox.markFailed({ deliveryId: 'd-1', error }))

    let row = await db.orm.public.GithubWebhookInbox.where({
      deliveryId: 'd-1',
    }).first()
    expect(row?.processedAt).toBeNull()
    expect(row?.processingError).toContain('deferred')

    refuse = false
    await db.orm.public.GithubWebhookInbox.where({ deliveryId: 'd-1' }).updateAndCount({
      nextAttemptAt: new Date(Date.now() - 1000),
    })
    await inbox.handleReconcile({
      process: (entry) => service.handle({ ...entry, replay: true }),
    })

    row = await db.orm.public.GithubWebhookInbox.where({
      deliveryId: 'd-1',
    }).first()
    expect(row?.processedAt).not.toBeNull()
    expect((await prStateRows())[0]).toMatchObject({
      checksRunning: 0,
      checksPassed: 4,
    })
  })
})
