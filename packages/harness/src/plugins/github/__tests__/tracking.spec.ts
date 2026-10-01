import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { checkoutKey, EPullRequestLookup, type RepositoryCheckout } from '../pure'
import { createPullRequestService } from '../pull-request-service'
import { createSessionFacts } from '../session'
import { aCheckout, pullRequestsByKey, wasFound } from '../testing'
import { createCheckoutTracking } from '../tracking'

const THREAD = toThreadId('thread-track')

const keyOf = (checkout: RepositoryCheckout): string => checkoutKey(checkout)

const rig = (args: {
  probed: RepositoryCheckout | null
  cloud?: () => RepositoryCheckout | null
}) => {
  const probeCalls: string[] = []
  const port = pullRequestsByKey({
    [keyOf(aCheckout({ branch: 'dennis/one' }))]: wasFound({ number: 1 }),
    [keyOf(aCheckout({ branch: 'dennis/two' }))]: wasFound({ number: 2 }),
    [keyOf(aCheckout({ branch: 'dennis/cloud-branch' }))]: wasFound({ number: 3 }),
  })
  const service = createPullRequestService({ pullRequests: port })
  const facts = createSessionFacts({ launchDirectory: '/workspace' })
  const tracking = createCheckoutTracking({
    service,
    facts,
    ...(args.cloud === undefined ? {} : { cloud: args.cloud }),
    probe: async ({ directory }) => {
      probeCalls.push(directory)
      return args.probed
    },
  })

  return { port, service, facts, tracking, probeCalls }
}

describe('the checkout tracking hooks', () => {
  it('tracks the probed checkout on the first turn when nothing follows the session yet', async () => {
    const { service, tracking } = rig({ probed: aCheckout({ branch: 'dennis/one' }) })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/workspace' })

    expect(service.current()?.checkout.branch).toBe('dennis/one')
    service.dispose()
  })

  it('does not probe at all when a surface already tracks a checkout', async () => {
    const { service, tracking, probeCalls } = rig({ probed: aCheckout({ branch: 'dennis/two' }) })
    service.track({ checkout: aCheckout({ branch: 'dennis/one' }) })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/workspace' })

    expect(probeCalls).toEqual([])
    expect(service.current()?.checkout.branch).toBe('dennis/one')
    service.dispose()
  })

  it('follows a branch hop at turn end and lands the new reading before record hooks run', async () => {
    const { service, tracking } = rig({ probed: aCheckout({ branch: 'dennis/two' }) })
    service.track({ checkout: aCheckout({ branch: 'dennis/one' }) })

    await tracking.afterTurn({ threadId: THREAD })

    const current = service.current()
    expect(current?.checkout.branch).toBe('dennis/two')
    expect(current?.reading.lookup).toBe(EPullRequestLookup.Found)
    if (current?.reading.lookup === EPullRequestLookup.Found) {
      expect(current.reading.pullRequest.number).toBe(2)
    }
    service.dispose()
  })

  it('stays put at turn end when the branch did not move', async () => {
    const { service, tracking, port } = rig({ probed: aCheckout({ branch: 'dennis/one' }) })
    const checkout = aCheckout({ branch: 'dennis/one' })
    service.track({ checkout })
    await service.refresh({ checkout, force: true })
    const askedBefore = port.asked.length

    await tracking.afterTurn({ threadId: THREAD })

    expect(service.current()?.checkout.branch).toBe('dennis/one')
    expect(port.asked.length).toBe(askedBefore)
    service.dispose()
  })

  it('leaves the service alone when the directory is not a checkout', async () => {
    const { service, tracking } = rig({ probed: null })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/workspace' })
    await tracking.afterTurn({ threadId: THREAD })

    expect(service.current()).toBeNull()
    service.dispose()
  })

  it('tracks the folded cloud checkout instead of probing the launch directory', async () => {
    const cloud = aCheckout({ branch: 'dennis/cloud-branch' })
    const { service, tracking, probeCalls } = rig({ probed: null, cloud: () => cloud })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/Users/dennis/Developer/atlas' })
    await tracking.afterTurn({ threadId: THREAD })

    expect(probeCalls).toEqual([])
    expect(service.current()?.checkout.branch).toBe('dennis/cloud-branch')
    service.dispose()
  })

  it('stops tracking when the cloud fold clears on descend', async () => {
    let folded: RepositoryCheckout | null = aCheckout({ branch: 'dennis/cloud-branch' })
    const { service, tracking } = rig({ probed: null, cloud: () => folded })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/cloud' })
    expect(service.current()?.checkout.branch).toBe('dennis/cloud-branch')

    folded = null
    await tracking.afterTurn({ threadId: THREAD })

    expect(service.current()).toBeNull()
    service.dispose()
  })
})
