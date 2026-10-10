import { describe, expect, it } from 'bun:test'

import { EToolEffect, toCallId, toThreadId } from '@dltech/atlas-core'

import { checkoutKey, EPullRequestLookup, type RepositoryCheckout } from '../pure'
import { createPullRequestService } from '../pull-request-service'
import { createSessionFacts } from '../session'
import { aCheckout, pullRequestsByKey, wasFound } from '../testing'
import { createCheckoutTracking } from '../tracking'

const THREAD = toThreadId('thread-track')

const keyOf = (checkout: RepositoryCheckout): string => checkoutKey(checkout)

const rig = (args: {
  probed: RepositoryCheckout | null | (() => RepositoryCheckout | null)
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
      return typeof args.probed === 'function' ? args.probed() : args.probed
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

  it('probes the directory even when something already tracks another checkout', async () => {
    const { service, tracking, probeCalls } = rig({ probed: aCheckout({ branch: 'dennis/two' }) })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/workspace' })

    expect(probeCalls).toEqual(['/workspace'])
    expect(service.current()?.checkout.branch).toBe('dennis/two')
    service.dispose()
  })

  it('follows a branch hop at turn end and lands the new reading before record hooks run', async () => {
    let probed = aCheckout({ branch: 'dennis/one' })
    const { service, tracking } = rig({ probed: () => probed })
    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/workspace' })

    probed = aCheckout({ branch: 'dennis/two' })
    await tracking.afterTurn({ threadId: THREAD })

    const current = service.current()
    expect(current?.checkout.branch).toBe('dennis/two')
    expect(service.tracked().map((checkout) => checkout.branch)).toEqual(['dennis/two'])
    expect(current?.reading.lookup).toBe(EPullRequestLookup.Found)
    if (current?.reading.lookup === EPullRequestLookup.Found) {
      expect(current.reading.pullRequest.number).toBe(2)
    }
    service.dispose()
  })

  it('stays put at turn end when the branch did not move', async () => {
    const { service, tracking, port } = rig({ probed: aCheckout({ branch: 'dennis/one' }) })
    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/workspace' })
    await service.refresh({ checkout: aCheckout({ branch: 'dennis/one' }), force: true })
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

  it('probes the sandbox directory when the cloud fold has no identity', async () => {
    const { service, tracking, probeCalls } = rig({
      probed: aCheckout({ branch: 'dennis/cloud-branch' }),
      cloud: () => null,
    })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/atlas/workspace' })

    expect(probeCalls).toEqual(['/atlas/workspace'])
    expect(service.current()?.checkout.branch).toBe('dennis/cloud-branch')
    service.dispose()
  })

  it('picks up a worktree created mid-session when the arrival marker had no identity', async () => {
    let probed: RepositoryCheckout | null = null
    const { service, tracking } = rig({ probed: () => probed, cloud: () => null })

    await tracking.beforeTurn({ threadId: THREAD, projectDirectory: '/atlas/workspace' })
    expect(service.current()).toBeNull()

    probed = aCheckout({ branch: 'dennis/cloud-branch' })
    await tracking.afterTurn({ threadId: THREAD })

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

describe('the family of threads', () => {
  const TEAMMATE = toThreadId('thread-teammate')

  const familyRig = () => {
    const places = new Map<string, RepositoryCheckout | null>()
    const port = pullRequestsByKey({
      [keyOf(aCheckout({ branch: 'dennis/one' }))]: wasFound({ number: 1 }),
      [keyOf(aCheckout({ branch: 'dennis/two' }))]: wasFound({ number: 2 }),
    })
    const service = createPullRequestService({ pullRequests: port })
    const tracking = createCheckoutTracking({
      service,
      facts: createSessionFacts({ launchDirectory: '/workspace' }),
      probe: async ({ directory }) => places.get(directory) ?? null,
    })
    places.set('/main', aCheckout({ branch: 'dennis/one', directory: '/main' }))
    places.set('/teammate', aCheckout({ branch: 'dennis/two', directory: '/teammate' }))

    return { places, port, service, tracking }
  }

  const branches = (service: ReturnType<typeof createPullRequestService>): string[] =>
    service.tracked().map((checkout) => checkout.branch).sort()

  it('tracks the main thread and a teammate at once, the main thread staying visible', async () => {
    const { service, tracking } = familyRig()

    await tracking.threadOpened({ threadId: THREAD, projectDirectory: '/main' })
    await tracking.beforeTurn({ threadId: TEAMMATE, projectDirectory: '/teammate' })

    expect(branches(service)).toEqual(['dennis/one', 'dennis/two'])
    expect(service.current()?.checkout.branch).toBe('dennis/one')
    expect(tracking.tracker.checkoutFor({ threadId: TEAMMATE })?.branch).toBe('dennis/two')
    service.dispose()
  })

  it('reads a teammate’s checkout the moment it is tracked', async () => {
    const { service, tracking, port } = familyRig()

    await tracking.threadOpened({ threadId: THREAD, projectDirectory: '/main' })
    await tracking.beforeTurn({ threadId: TEAMMATE, projectDirectory: '/teammate' })
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(port.asked).toEqual([
      keyOf(aCheckout({ branch: 'dennis/one' })),
      keyOf(aCheckout({ branch: 'dennis/two' })),
    ])
    service.dispose()
  })

  it('drops only a thread’s own checkout when it leaves its worktree', async () => {
    const { places, service, tracking } = familyRig()
    await tracking.threadOpened({ threadId: THREAD, projectDirectory: '/main' })
    await tracking.beforeTurn({ threadId: TEAMMATE, projectDirectory: '/teammate' })

    places.set('/teammate', null)
    await tracking.afterTurn({ threadId: TEAMMATE })

    expect(branches(service)).toEqual(['dennis/one'])
    expect(tracking.tracker.checkoutFor({ threadId: TEAMMATE })).toBeNull()
    expect(tracking.tracker.checkoutFor({ threadId: THREAD })?.branch).toBe('dennis/one')
    service.dispose()
  })

  it('keeps a checkout two threads share until the last of them leaves', async () => {
    const { places, service, tracking } = familyRig()
    places.set('/teammate', aCheckout({ branch: 'dennis/one', directory: '/main' }))
    await tracking.threadOpened({ threadId: THREAD, projectDirectory: '/main' })
    await tracking.beforeTurn({ threadId: TEAMMATE, projectDirectory: '/teammate' })

    places.set('/teammate', null)
    await tracking.afterTurn({ threadId: TEAMMATE })

    expect(branches(service)).toEqual(['dennis/one'])
    service.dispose()
  })

  it('follows a teammate entering a worktree mid-turn without moving the main thread', async () => {
    const { places, service, tracking } = familyRig()
    await tracking.threadOpened({ threadId: THREAD, projectDirectory: '/main' })
    await tracking.beforeTurn({ threadId: TEAMMATE, projectDirectory: '/workspace' })
    expect(branches(service)).toEqual(['dennis/one'])

    await tracking.followWorktree({
      call: {
        callId: toCallId('call-enter'),
        name: 'enter_worktree',
        input: {},
        effect: EToolEffect.Destructive,
        threadId: TEAMMATE,
      },
      result: {
        ok: true,
        output: { enteredWorktree: { path: '/teammate', branch: 'dennis/two' } },
        modelText: 'entered',
      },
      projectDirectory: '/workspace',
      signal: new AbortController().signal,
    })

    expect(places.get('/teammate')?.branch).toBe('dennis/two')
    expect(branches(service)).toEqual(['dennis/one', 'dennis/two'])
    expect(tracking.tracker.checkoutFor({ threadId: THREAD })?.branch).toBe('dennis/one')
    service.dispose()
  })

  it('makes the opened thread the visible one', async () => {
    const { service, tracking } = familyRig()
    await tracking.threadOpened({ threadId: THREAD, projectDirectory: '/main' })
    await tracking.beforeTurn({ threadId: TEAMMATE, projectDirectory: '/teammate' })

    await tracking.threadOpened({ threadId: TEAMMATE, projectDirectory: '/teammate' })

    expect(service.current()?.checkout.branch).toBe('dennis/two')
    service.dispose()
  })
})
