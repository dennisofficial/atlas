import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { prEventRows, seedPrState } from '../../../../test/github-seed'
import { waitFor } from '../../../../test/fake-timers'
import {
  FILLED_PR_STATE,
  prepareDelivery,
  PULL_REQUEST_PAYLOAD,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'

describe('GithubDeliveryService discussion mailbox', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('a PR issue_comment delivery writes a mailbox row per subscriber and pushes a live frame', async () => {
    const { service, fanout } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' } })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedSubscription({ userId: 'usr-b', prNumber: 42 })
    await seedSubscription({ userId: 'usr-c', prNumber: 7 })

    const received: unknown[] = []
    fanout.openStream({
      userId: 'usr-a',
      handler: () => undefined,
      eventHandler: (event) => received.push(event),
    })

    const outcome = await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: {
          body: 'ship it',
          html_url: 'https://github.com/compai/app/pull/42#issuecomment-1',
        },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(outcome.handled).toBe(true)
    expect(await prEventRows()).toHaveLength(2)
    const userIds = (await prEventRows()).map((row) => row.userId).sort()
    expect(userIds).toEqual(['usr-a', 'usr-b'])
    const byUser = new Map((await prEventRows()).map((row) => [row.userId, row]))
    expect(byUser.get('usr-a')).toMatchObject({
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: 'comment',
      payload: {
        url: 'https://github.com/compai/app/pull/42#issuecomment-1',
        authorLogin: 'dennis',
        body: 'ship it',
      },
    })
    await waitFor(async () => {
      const delivered = new Map((await prEventRows()).map((row) => [row.userId, row]))
      expect(delivered.get('usr-a')?.deliveredAt).not.toBeNull()
    })
    expect((await prEventRows()).find((row) => row.userId === 'usr-b')?.deliveredAt).toBeNull()
    expect(
      ((await prEventRows())[0]?.payload as Record<string, unknown>).headSha,
    ).toBeUndefined()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ kind: 'comment', prNumber: 42 })
  })

  it('ignores an issue_comment on a plain issue and non-created actions', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: { number: 42, html_url: 'https://github.com/compai/app/issues/42' },
        comment: { body: 'not a pr', html_url: 'https://github.com/compai/app/issues/42#issuecomment-2' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })
    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'edited',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: { body: 'edited', html_url: 'https://github.com/compai/app/pull/42#issuecomment-3' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(0)
  })

  it('records an approved review with its body and state', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    const outcome = await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: {
          state: 'approved',
          body: 'looks good',
          html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-1',
        },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(outcome.handled).toBe(true)
    expect(await prEventRows()).toHaveLength(1)
    expect((await prEventRows())[0]).toMatchObject({
      kind: 'review',
      payload: {
        url: 'https://github.com/compai/app/pull/42#pullrequestreview-1',
        authorLogin: 'reviewer',
        body: 'looks good',
        reviewState: 'approved',
        headSha: 'abc123',
      },
    })
  })

  it('skips review states that are not recorded and non-submitted actions', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: { state: 'dismissed', body: null, html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-9' },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })
    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'edited',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: { state: 'approved', body: null, html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-1' },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(0)
  })

  it('records an inline review comment', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review_comment',
      payload: {
        action: 'created',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        comment: {
          body: 'nit: rename this',
          html_url: 'https://github.com/compai/app/pull/42#discussion_r1',
        },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(1)
    expect((await prEventRows())[0]).toMatchObject({
      kind: 'review-comment',
      payload: {
        url: 'https://github.com/compai/app/pull/42#discussion_r1',
        authorLogin: 'reviewer',
        body: 'nit: rename this',
        headSha: 'abc123',
      },
    })
  })

  it('a comment delivery reaches a branch subscriber through the recorded head branch', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-branch', prNumber: null, branch: 'dennis/add-the-thing' })
    await seedPrState({ ...FILLED_PR_STATE })

    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: { body: 'nice', html_url: 'https://github.com/compai/app/pull/42#issuecomment-4' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(1)
    expect((await prEventRows())[0]?.userId).toBe('usr-branch')
  })

  it('records no mailbox row when nobody subscribes', async () => {
    const { service } = serviceWith({ tokens: {} })

    await service.handle({
      event: 'issue_comment',
      payload: {
        action: 'created',
        issue: {
          number: 42,
          html_url: 'https://github.com/compai/app/pull/42',
          pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
        },
        comment: { body: 'hello', html_url: 'https://github.com/compai/app/pull/42#issuecomment-5' },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(0)
  })
})
