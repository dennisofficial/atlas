import { describe, expect, it } from 'bun:test'

import { checkoutKey } from '../pure'
import { createPullRequestService } from '../pull-request-service'
import {
  aCheckout,
  countingPort,
  pullRequestsAnswering,
  WAS_ABSENT as ABSENT,
  wasFound as found,
} from '../testing'

describe('createPullRequestService onPolled', () => {
  it('reports each polled Found reading with its repo and key', async () => {
    const polled: Array<{ key: string; repo: string; number: number }> = []
    const service = createPullRequestService({
      pullRequests: pullRequestsAnswering(found({ number: 9 }), ABSENT),
      onPolled: ({ key, repo, pullRequest }) => polled.push({ key, repo, number: pullRequest.number }),
    })
    const checkout = aCheckout()

    await service.refresh({ checkout })

    expect(polled).toEqual([
      { key: checkoutKey(checkout), repo: 'github.com/dennisofficial/atlas', number: 9 },
    ])
    service.dispose()
  })

  it('stays silent for a pushing port, whose frames arrive through ingest', async () => {
    const polled: number[] = []
    const service = createPullRequestService({
      pullRequests: countingPort({ pushes: true, reading: found() }),
      onPolled: () => polled.push(1),
    })

    await service.refresh({ checkout: aCheckout(), force: true })

    expect(polled).toEqual([])
    service.dispose()
  })

  it('survives a throwing listener', async () => {
    const service = createPullRequestService({
      pullRequests: pullRequestsAnswering(found()),
      onPolled: () => {
        throw new Error('boom')
      },
    })
    const checkout = aCheckout()

    await service.refresh({ checkout })

    expect(service.snapshot({ key: checkoutKey(checkout) })).toEqual(found())
    service.dispose()
  })
})

