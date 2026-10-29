import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  prEventRows,
  seedCloudSandbox,
  seedSubscription as seedSubscriptionRow,
} from '../../../../test/github-seed'
import { prepareDelivery, PULL_REQUEST_PAYLOAD, serviceWith } from './github-delivery.fixture'
import type { GithubPrStateDto } from './github-realtime.types'

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

  const sandboxAt = (args: { userId: string; lastActivityAt: Date }): Promise<unknown> =>
    seedCloudSandbox({
      id: 'sbx_row_1',
      threadId: 'thr_1',
      userId: args.userId,
      sandboxId: 'sbx_1',
      name: 'atlas-thr_1',
      state: 'parked',
      lastActivityAt: args.lastActivityAt,
    })

  const sandboxWithinWindow = (): Promise<unknown> =>
    sandboxAt({ userId: 'usr-parked', lastActivityAt: new Date(Date.now() - 60 * 60 * 1_000) })

  it('a delivery fans out to an expired subscription whose sandbox is inside the wake window', async () => {
    const { service, fanout } = serviceWith({ tokens: { 'usr-parked': 'ghu_1' } })
    const pushes: GithubPrStateDto[] = []
    fanout.openStream({
      userId: 'usr-parked',
      handler: (state) => pushes.push(state),
      eventHandler: () => {},
      onClosed: () => {},
    })
    await sandboxWithinWindow()
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

  it('a delivery skips an expired subscription whose sandbox fell out of the wake window', async () => {
    const { service, fanout } = serviceWith({ tokens: { 'usr-stale': 'ghu_1' } })
    const pushes: GithubPrStateDto[] = []
    fanout.openStream({
      userId: 'usr-stale',
      handler: (state) => pushes.push(state),
      eventHandler: () => {},
      onClosed: () => {},
    })
    await sandboxAt({
      userId: 'usr-stale',
      lastActivityAt: new Date(Date.now() - 25 * 60 * 60 * 1_000),
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

  it('a delivery skips an expired subscription with a threadId but no sandbox row', async () => {
    const { service, fanout } = serviceWith({ tokens: { 'usr-gone': 'ghu_1' } })
    const pushes: GithubPrStateDto[] = []
    fanout.openStream({
      userId: 'usr-gone',
      handler: (state) => pushes.push(state),
      eventHandler: () => {},
      onClosed: () => {},
    })
    await seedCloudSandbox({ threadId: 'thr_gone', userId: 'usr-gone' })
    await parkSubscription({
      userId: 'usr-gone',
      threadId: 'thr_gone',
      expiresAt: new Date(Date.now() - 60_000),
    })
    await db.orm.public.CloudSandbox.where({ sessionId: 'ses_thr_gone' }).deleteAndCount()
    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(pushes).toHaveLength(0)
  })

  it('a discussion delivery records a mailbox row for an in-window parked subscriber', async () => {
    const { service } = serviceWith({ tokens: { 'usr-parked': 'ghu_1' } })
    await sandboxWithinWindow()
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
