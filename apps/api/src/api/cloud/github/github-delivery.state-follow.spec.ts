import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { prStateRows, seedPrState } from '../../../../test/github-seed'
import {
  FILLED_PR_STATE,
  prepareDelivery,
  PULL_REQUEST_PAYLOAD,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'

const pullPayload = (over: {
  action: string
  state: string
  draft: boolean
  merged_at: string | null
}) => ({
  ...PULL_REQUEST_PAYLOAD,
  action: over.action,
  pull_request: {
    ...PULL_REQUEST_PAYLOAD.pull_request,
    state: over.state,
    draft: over.draft,
    merged_at: over.merged_at,
  },
})

describe('GithubDeliveryService tracked state', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('turns the tracked row merged when the pull_request delivery closes a merged pr', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, state: 'draft' })

    await service.handle({
      event: 'pull_request',
      payload: pullPayload({
        action: 'closed',
        state: 'closed',
        draft: false,
        merged_at: '2026-11-10T02:31:00Z',
      }),
    })

    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42, state: 'merged' })
  })

  it('keeps a merged row merged when an older opened payload is replayed', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, state: 'merged' })

    await service.handle({
      event: 'pull_request',
      payload: pullPayload({
        action: 'opened',
        state: 'open',
        draft: true,
        merged_at: null,
      }),
    })

    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42, state: 'merged' })
  })

  it('lets a reopened payload move a closed row back to open', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, state: 'closed' })

    await service.handle({
      event: 'pull_request',
      payload: pullPayload({
        action: 'reopened',
        state: 'open',
        draft: false,
        merged_at: null,
      }),
    })

    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42, state: 'open' })
  })

  it('clears the draft flag when the pull_request delivery is ready_for_review', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ ...FILLED_PR_STATE, state: 'draft' })

    await service.handle({
      event: 'pull_request',
      payload: pullPayload({
        action: 'ready_for_review',
        state: 'open',
        draft: false,
        merged_at: null,
      }),
    })

    expect((await prStateRows())[0]).toMatchObject({ prNumber: 42, state: 'open' })
  })
})
