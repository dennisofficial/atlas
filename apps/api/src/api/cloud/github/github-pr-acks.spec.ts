import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedSubscription } from '../../../../test/github-seed'
import { waitFor } from '../../../../test/fake-timers'
import { prepareDelivery, serviceWith } from '@dltech/atlas-github/testing'

const COMMENT_PAYLOAD = {
  action: 'created',
  issue: {
    number: 42,
    html_url: 'https://github.com/compai/app/pull/42',
    pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
  },
  comment: { body: 'ship it', html_url: 'https://github.com/compai/app/pull/42#issuecomment-1' },
  sender: { login: 'dennis' },
  repository: { full_name: 'compai/app' },
}

const deliveryRows = () => db.orm.public.GithubPrEventDelivery.all()

describe('github pr-event deliveries', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('writes a delivery row only for the threads subscribed to the delivered pr', async () => {
    const { service, fanout } = serviceWith({ tokens: {} })
    await seedSubscription({
      userId: 'usr-a',
      threadId: 'thr-watches',
      prNumber: 42,
      branch: '#42',
    })
    await seedSubscription({ userId: 'usr-a', threadId: 'thr-other', prNumber: 7, branch: '#7' })

    const seen: string[] = []
    for (const threadId of ['thr-watches', 'thr-other']) {
      fanout.openStream({
        userId: 'usr-a',
        threadId,
        handler: () => undefined,
        eventHandler: () => seen.push(threadId),
      })
    }

    await service.handle({ event: 'issue_comment', payload: COMMENT_PAYLOAD })

    await waitFor(async () => expect(await deliveryRows()).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await deliveryRows()).map((row) => row.threadId)).toEqual(['thr-watches'])
    expect(seen.sort()).toEqual(['thr-other', 'thr-watches'])
  })
})
