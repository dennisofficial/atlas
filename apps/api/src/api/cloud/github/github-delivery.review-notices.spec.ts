import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { prEventRows } from '../../../../test/github-seed'
import {
  prepareDelivery,
  PULL_REQUEST_PAYLOAD,
  seedSubscription,
  serviceWith,
} from './github-delivery.fixture'

describe('GithubDeliveryService review notices', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('drops the empty commented review GitHub wraps around an inline reply', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: {
          state: 'commented',
          body: '',
          html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-11',
        },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(0)
  })

  it('drops a null-body commented review', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: {
          state: 'commented',
          body: null,
          html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-12',
        },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(0)
  })

  it('drops a whitespace-only commented review', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: {
          state: 'commented',
          body: '  \n\t ',
          html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-13',
        },
        sender: { login: 'dennis' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(0)
  })

  it('records a commented review that carries a body', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: {
          state: 'commented',
          body: 'a summary of the whole review',
          html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-14',
        },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(1)
    expect((await prEventRows())[0]).toMatchObject({
      kind: 'review',
      payload: {
        authorLogin: 'reviewer',
        body: 'a summary of the whole review',
        reviewState: 'commented',
      },
    })
  })

  it('records an approved review with a null body', async () => {
    const { service } = serviceWith({ tokens: {} })
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })

    await service.handle({
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        pull_request: PULL_REQUEST_PAYLOAD.pull_request,
        review: {
          state: 'approved',
          body: null,
          html_url: 'https://github.com/compai/app/pull/42#pullrequestreview-15',
        },
        sender: { login: 'reviewer' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(await prEventRows()).toHaveLength(1)
    expect((await prEventRows())[0]).toMatchObject({
      kind: 'review',
      payload: { authorLogin: 'reviewer', reviewState: 'approved' },
    })
    expect(
      ((await prEventRows())[0]?.payload as Record<string, unknown> | undefined)?.body,
    ).toBeUndefined()
  })
})
