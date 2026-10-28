import { describe, expect, it } from 'bun:test'

import { EPrEventKind, EPullRequestState } from '@dltech/atlas-core'

import { EOccurrenceUrgency, type SubscriptionOccurrence } from '../../../subscriptions/provider'
import { createPullRequestProvider } from '../pull-request-provider'
import { createPullRequestService } from '../pull-request-service'
import { pullRequestsAnswering, wasFound } from '../testing'
import { frame, REPO, subscription } from './provider-fixtures'

const KEY = `${REPO}#42`

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const setup = (first: ReturnType<typeof wasFound>) => {
  const service = createPullRequestService({ pullRequests: pullRequestsAnswering(first) })
  const provider = createPullRequestProvider({
    tracker: { checkoutFor: () => null },
    service,
    onTargets: (targets) => service.watch({ links: [], extra: targets }),
    probe: async () => null,
  })
  const emitted: SubscriptionOccurrence[] = []
  const start = (id = 'sub-1') =>
    provider.start({ subscription: subscription({ id }), emit: (o) => emitted.push(o) })

  return { service, provider, emitted, start }
}

const merged = () => wasFound({ state: EPullRequestState.Merged })
const closed = () => wasFound({ state: EPullRequestState.Closed })

describe('ending a subscription from a reading', () => {
  it('ends once, with one notice, a subscription started on an already merged pull request', async () => {
    const { service, emitted, start } = setup(merged())

    const stop = start()
    await sleep(20)

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      key: 'state',
      urgency: EOccurrenceUrgency.Now,
      ends: true,
      draft: {
        type: 'pr-event',
        kind: EPrEventKind.State,
        state: 'merged',
        repo: REPO,
        prNumber: 42,
        url: 'https://github.com/dennisofficial/atlas/pull/42',
      },
    })

    await sleep(20)
    expect(emitted).toHaveLength(1)
    stop()
    service.dispose()
  })

  it('ends a subscription when a later reading shows the pull request closed', async () => {
    const { service, emitted, start } = setup(wasFound())
    const stop = start()
    await sleep(20)
    expect(emitted).toEqual([])

    service.ingest({ key: KEY, reading: closed() })

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ ends: true, draft: { state: 'closed' } })
    stop()
    service.dispose()
  })

  it('does not end it on an open or draft reading', async () => {
    const { service, emitted, start } = setup(wasFound())
    const stop = start()
    await sleep(20)

    service.ingest({ key: KEY, reading: wasFound({ state: EPullRequestState.Draft }) })

    expect(emitted).toEqual([])
    stop()
    service.dispose()
  })

  it('ends only once when a merged frame is followed by a merged reading', async () => {
    const { provider, service, emitted, start } = setup(wasFound())
    const stop = start()
    await sleep(20)

    provider.onFrame(frame({ kind: EPrEventKind.State, payload: { state: 'merged' } }))
    service.ingest({ key: KEY, reading: merged() })

    expect(emitted).toHaveLength(1)
    stop()
    service.dispose()
  })

  it('ends only once when a merged reading is followed by a merged frame', async () => {
    const { provider, service, emitted, start } = setup(wasFound())
    const stop = start()
    await sleep(20)

    service.ingest({ key: KEY, reading: merged() })
    provider.onFrame(frame({ kind: EPrEventKind.State, payload: { state: 'merged' } }))

    expect(emitted).toHaveLength(1)
    stop()
    service.dispose()
  })

  it('ends every subscription on the pull request, each once', async () => {
    const { service, emitted, start } = setup(wasFound())
    const stopA = start('a')
    const stopB = start('b')
    await sleep(20)

    service.ingest({ key: KEY, reading: merged() })
    service.ingest({ key: KEY, reading: merged() })

    expect(emitted).toHaveLength(2)
    stopA()
    stopB()
    service.dispose()
  })

  it('stops listening to readings once the subscription stops', async () => {
    const { service, emitted, start } = setup(wasFound())
    const stop = start()
    await sleep(20)
    stop()

    service.ingest({ key: KEY, reading: merged() })

    expect(emitted).toEqual([])
    service.dispose()
  })
})
