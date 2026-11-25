import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import type { GithubPrStateDto } from '@dltech/atlas-github'
import {
  PULL_REQUEST_PAYLOAD,
  prepareDelivery,
  prEventRows,
  seedSubscription as seedSubscriptionRow,
  serviceWith,
} from '@dltech/atlas-github/testing'

describe('GithubDeliveryService parked-subscription survival', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  const parkSubscription = (args: {
    userId: string
    threadId: string
    expiresAt: Date
    liveUntil?: Date
  }): Promise<unknown> =>
    seedSubscriptionRow({
      id: `sub-parked-${args.userId}`,
      userId: args.userId,
      prNumber: 42,
      branch: '#42',
      expiresAt: args.expiresAt,
      liveUntil: args.liveUntil ?? args.expiresAt,
      threadId: args.threadId,
    })

  it('a delivery fans out to an expired subscription whose liveUntil covers the wake window', async () => {
    const { service, fanout } = serviceWith({ tokens: {} })
    const pushes: GithubPrStateDto[] = []
    fanout.openStream({
      userId: 'usr-parked',
      handler: (state) => pushes.push(state),
      eventHandler: () => {},
      onClosed: () => {},
    })
    await parkSubscription({
      userId: 'usr-parked',
      threadId: 'thr_1',
      expiresAt: new Date(Date.now() - 60_000),
      liveUntil: new Date(Date.now() + 60_000),
    })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(pushes).toHaveLength(1)
    expect((await prEventRows()).filter((row) => row.userId === 'usr-parked')).toHaveLength(0)
  })

  it('a delivery skips an expired subscription whose liveUntil has passed', async () => {
    const { service, fanout } = serviceWith({ tokens: { 'usr-stale': 'ghu_1' } })
    const pushes: GithubPrStateDto[] = []
    fanout.openStream({
      userId: 'usr-stale',
      handler: (state) => pushes.push(state),
      eventHandler: () => {},
      onClosed: () => {},
    })
    await parkSubscription({
      userId: 'usr-stale',
      threadId: 'thr_1',
      expiresAt: new Date(Date.now() - 60_000),
    })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(pushes).toHaveLength(0)
    expect((await prEventRows()).filter((row) => row.userId === 'usr-stale')).toHaveLength(0)
  })

  it('a discussion delivery records a mailbox row for a subscriber inside the wake window', async () => {
    const { service } = serviceWith({ tokens: { 'usr-parked': 'ghu_1' } })
    await parkSubscription({
      userId: 'usr-parked',
      threadId: 'thr_1',
      expiresAt: new Date(Date.now() - 60_000),
      liveUntil: new Date(Date.now() + 60_000),
    })

    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 42, pull_request: {} },
        comment: {
          id: 9001,
          body: 'looks good',
          html_url: 'https://github.com/compai/app/pull/42#issuecomment-9001',
          user: { login: 'reviewer' },
        },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect((await prEventRows()).filter((row) => row.userId === 'usr-parked')).toHaveLength(1)
  })
})
