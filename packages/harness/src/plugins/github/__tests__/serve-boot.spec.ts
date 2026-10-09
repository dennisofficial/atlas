import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { SsePullRequestPort } from '../../../cloud/sse-pull-requests'

import { createSessionFacts } from '../session'
import { createPullRequestService } from '../pull-request-service'
import { checkoutKey, EPullRequestLookup, type RepositoryCheckout } from '../pure'
import { aCheckout, pullRequestsByKey, wasFound } from '../testing'
import { createCheckoutTracking } from '../tracking'

const THREAD = toThreadId('thread-boot')

const CLOUD_SESSION = { url: 'https://api.test', token: 'tok', email: null }

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const respond = (body: unknown, status = 201): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const subscribeBody = {
  id: 'sub_boot',
  repoFullName: 'dennisofficial/atlas',
  prNumber: 3,
  pollBacked: false,
  expiresAt: '2026-10-09T21:00:00.000Z',
  state: null,
}

describe('checkout tracking at boot', () => {
  it('tracks the probed launch directory before any turn runs', async () => {
    const service = createPullRequestService({
      pullRequests: pullRequestsByKey({
        [checkoutKey(aCheckout({ branch: 'dennis/one' }))]: wasFound({ number: 1 }),
      }),
    })
    const tracking = createCheckoutTracking({
      service,
      facts: createSessionFacts({ launchDirectory: '/workspace' }),
      probe: async () => aCheckout({ branch: 'dennis/one' }),
    })

    await tracking.boot()

    expect(service.current()?.checkout.branch).toBe('dennis/one')
    service.dispose()
  })

  it('does nothing when the launch directory is not a checkout', async () => {
    const service = createPullRequestService({
      pullRequests: pullRequestsByKey({}),
    })
    const tracking = createCheckoutTracking({
      service,
      facts: createSessionFacts({ launchDirectory: '/workspace' }),
      probe: async () => null,
    })

    await tracking.boot()

    expect(service.current()).toBeNull()
    service.dispose()
  })

  it('never undoes tracking a live surface already set up', async () => {
    const service = createPullRequestService({
      pullRequests: pullRequestsByKey({}),
    })
    service.track({ checkout: aCheckout({ branch: 'dennis/one' }) })
    const tracking = createCheckoutTracking({
      service,
      facts: createSessionFacts({ launchDirectory: '/workspace' }),
      probe: async () => null,
    })

    await tracking.boot()

    expect(service.current()?.checkout.branch).toBe('dennis/one')
    service.dispose()
  })

  it('re-tracks a cloud boot whose launch directory is a checkout without waiting for a turn', async () => {
    const checkout = aCheckout({ branch: 'dennis/cloud-branch', directory: '/workspace' })
    const realFetch = globalThis.fetch
    const subscribed: string[] = []
    globalThis.fetch = (async (url: unknown, init: { body?: string } = {}) => {
      const target = String(url)
      if (target.endsWith('/v1/github/subscriptions')) {
        subscribed.push(String(JSON.parse(init.body ?? '{}').branch))
        return respond(subscribeBody)
      }
      return new Promise<Response>(() => {})
    }) as unknown as typeof fetch

    const port = new SsePullRequestPort({
      session: CLOUD_SESSION,
      clientVersion: 'test',
      onReading: () => undefined,
    })

    try {
      const service = createPullRequestService({ pullRequests: port })
      const tracking = createCheckoutTracking({
        service,
        facts: createSessionFacts({ launchDirectory: '/workspace' }),
        cloud: () => null,
        probe: async () => checkout,
      })

      await tracking.boot()
      await sleep(10)

      expect(service.current()?.checkout.branch).toBe('dennis/cloud-branch')
      expect(subscribed).toEqual(['dennis/cloud-branch'])
      service.dispose()
    } finally {
      port.dispose()
      globalThis.fetch = realFetch
    }
  })

  it("boot on a cadence-governed port is the caller's decision — tracking alone asks nothing eagerly", async () => {
    const port = pullRequestsByKey({
      [checkoutKey(aCheckout({ branch: 'dennis/one' }))]: wasFound({ number: 1 }),
    })
    const service = createPullRequestService({ pullRequests: port })
    createCheckoutTracking({
      service,
      facts: createSessionFacts({ launchDirectory: '/workspace' }),
      probe: async () => aCheckout({ branch: 'dennis/one' }),
    })

    expect(service.current()).toBeNull()
    expect(port.asked).toEqual([])
    service.dispose()
  })

  it('boot defers to the folded cloud checkout when one exists', async () => {
    const folded = aCheckout({ branch: 'dennis/cloud-branch' })
    const probeCalls: string[] = []
    const service = createPullRequestService({
      pullRequests: pullRequestsByKey({
        [checkoutKey(folded)]: wasFound({ number: 3 }),
      }),
    })
    const tracking = createCheckoutTracking({
      service,
      facts: createSessionFacts({ launchDirectory: '/workspace' }),
      cloud: () => folded,
      probe: async ({ directory }) => {
        probeCalls.push(directory)
        return null
      },
    })

    await tracking.boot()

    expect(probeCalls).toEqual([])
    expect(service.current()?.checkout.branch).toBe('dennis/cloud-branch')
    service.dispose()
  })

  it('boot stops tracking when the cloud fold cleared and the directory is no checkout', async () => {
    const service = createPullRequestService({
      pullRequests: pullRequestsByKey({}),
    })
    const tracking = createCheckoutTracking({
      service,
      facts: createSessionFacts({ launchDirectory: '/workspace' }),
      cloud: () => null,
      probe: async () => null,
    })

    await tracking.boot()

    expect(service.current()).toBeNull()
    service.dispose()
  })
})
