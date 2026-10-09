import { describe, expect, it } from 'bun:test'

import { EPullRequestStateWire } from '@dltech/atlas-wire'

import { EChecksState, EPullRequestLookup } from '../pure'
import { createPullRequestService } from '../pull-request-service'
import { aCheckout, aLink, pullRequestsAnswering, wasFound as found } from '../testing'

const settledChecks = { running: 0, passed: 4, failed: 1 }

describe('pull request states snapshot for the channel', () => {
  it('enumerates the tracked checkout and watched links as wire states', async () => {
    const port = pullRequestsAnswering(
      found({ number: 7, tally: settledChecks, mergeable: false }),
      found({ number: 42 }),
    )
    const service = createPullRequestService({ pullRequests: port })

    const checkout = aCheckout({ branch: 'dennis/first' })
    service.track({ checkout })
    service.watch({ links: [aLink({ number: 42 })] })
    await service.refresh({ checkout, force: true })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const states = service.states()
    expect(states).toHaveLength(2)
    const tracked = states.find((state) => state.number === 7)
    expect(tracked?.state).toBe(EPullRequestStateWire.Open)
    expect(tracked?.checksPassed).toBe(4)
    expect(tracked?.checksFailed).toBe(1)
    expect(tracked?.mergeable).toBe(false)
    const linked = states.find((state) => state.number === 42)
    expect(linked?.repo).toBe('github.com/dennisofficial/atlas')
    service.dispose()
  })

  it('drops non-Found readings from the snapshot', async () => {
    const port = pullRequestsAnswering({ lookup: EPullRequestLookup.Absent })
    const service = createPullRequestService({ pullRequests: port })

    const checkout = aCheckout()
    service.track({ checkout })
    await service.refresh({ checkout, force: true })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(service.states()).toEqual([])
    service.dispose()
  })
})
