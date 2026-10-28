import { describe, expect, it } from 'bun:test'

import {
  EPrEventKind,
  EPrVerdict,
  ESubscriptionActor,
  ESubscriptionEnd,
  toRunId,
  toThreadId,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { PrEventFrame } from '../../cloud/pr-event-frame'
import {
  createPullRequestProvider,
  PULL_REQUEST_PROVIDER_KIND,
} from '../../plugins/github/pull-request-provider'
import { createPullRequestService } from '../../plugins/github/pull-request-service'
import { pullRequestsAnswering, wasFound } from '../../plugins/github/testing'
import { FakeClock } from '../../subscriptions/__tests__/fake-schedule'
import { MemoryLog } from '../../subscriptions/__tests__/memory-log'
import { SubscriptionRegistry } from '../../subscriptions/registry'

const MAIN = toThreadId('main')
const CHILD = toThreadId('child')

let sequence = 0
const frame = (args: {
  kind: EPrEventKind
  prNumber?: number
  payload?: Partial<PrEventFrame['payload']>
}): PrEventFrame => {
  sequence += 1
  return {
    id: `frame-${sequence}`,
    repoFullName: 'owner/repo',
    prNumber: args.prNumber ?? 7,
    kind: args.kind,
    payload: { url: 'https://github.com/owner/repo/pull/7', ...args.payload },
    createdAt: 't',
  }
}

const failedVerdict = (): PrEventFrame =>
  frame({ kind: EPrEventKind.Verdict, payload: { verdict: EPrVerdict.Failed, headSha: 'abc' } })
const greenVerdict = (): PrEventFrame =>
  frame({ kind: EPrEventKind.Verdict, payload: { verdict: EPrVerdict.Green, headSha: 'abc' } })
const mergeability = (): PrEventFrame =>
  frame({ kind: EPrEventKind.Mergeability, payload: { mergeable: false } })
const merged = (): PrEventFrame => frame({ kind: EPrEventKind.State, payload: { state: 'merged' } })

const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

const wired = (args: { parents?: ReadonlyMap<ThreadId, ThreadId> } = {}) => {
  const log = new MemoryLog()
  const clock = new FakeClock()
  const service = createPullRequestService({ pullRequests: pullRequestsAnswering(wasFound()) })
  const provider = createPullRequestProvider({
    tracker: { checkoutFor: () => null },
    service,
    onTargets: () => undefined,
    probe: async () => null,
  })
  let counter = 0
  const ids: IdPort = {
    nextThreadId: () => toThreadId('thread'),
    nextRunId: () => toRunId(`run-${counter++}`),
    nextEventId: () => {
      throw new Error('unused')
    },
    nextCallId: () => {
      throw new Error('unused')
    },
  }
  let next = 0
  const registry = new SubscriptionRegistry({
    log,
    ids,
    owners: { ownerOf: async ({ threadId }) => args.parents?.get(threadId) ?? threadId },
    providers: [provider],
    now: clock.now,
    schedule: clock.schedule,
    newId: () => `sub-${++next}`,
  })

  const subscribe = async (input: string, threadId: ThreadId = MAIN) => {
    const outcome = await registry.subscribe({
      threadId,
      provider: PULL_REQUEST_PROVIDER_KIND,
      input,
      projectDirectory: '/repo',
      by: ESubscriptionActor.Agent,
    })
    if (!outcome.ok) throw new Error(outcome.error)
    return outcome.subscription
  }

  return { registry, provider, log, clock, service, subscribe, intake: registry.intakeSource }
}

const kindsOf = (drafts: readonly { type: string }[]): string[] =>
  drafts.map((draft) => ('kind' in draft ? String(draft.kind) : draft.type))

describe('subscription delivery, provider to intake', () => {
  it('produces nothing for a frame on a pull request nobody subscribed to', async () => {
    const { provider, intake } = wired()

    provider.onFrame(failedVerdict())
    await settled()

    const batch = await intake.prepare({ threadId: MAIN })
    expect(batch.drafts).toEqual([])
    expect(batch.wakesTurn).toBe(false)
  })

  it('wakes the thread with one pr-event for a failed verdict after subscribe', async () => {
    const { provider, intake, subscribe } = wired()
    await subscribe('owner/repo#7')

    provider.onFrame(failedVerdict())

    const batch = await intake.prepare({ threadId: MAIN })
    expect(batch.wakesTurn).toBe(true)
    expect(batch.drafts).toHaveLength(1)
    expect(batch.drafts[0]).toMatchObject({
      type: 'pr-event',
      repo: 'github.com/owner/repo',
      prNumber: 7,
      kind: EPrEventKind.Verdict,
      verdict: EPrVerdict.Failed,
    })
  })

  it('ignores a frame for a different pull request on the same repository', async () => {
    const { provider, intake, subscribe } = wired()
    await subscribe('owner/repo#7')

    provider.onFrame(
      frame({ kind: EPrEventKind.Verdict, prNumber: 8, payload: { verdict: EPrVerdict.Failed } }),
    )

    const batch = await intake.prepare({ threadId: MAIN })
    expect(batch.drafts).toEqual([])
  })

  it('holds a mergeability frame and delivers it with the green verdict in order', async () => {
    const { provider, intake, subscribe } = wired()
    await subscribe('owner/repo#7')

    provider.onFrame(mergeability())
    const held = await intake.prepare({ threadId: MAIN })
    expect(held.wakesTurn).toBe(false)

    provider.onFrame(greenVerdict())

    const batch = await intake.prepare({ threadId: MAIN })
    expect(batch.wakesTurn).toBe(true)
    expect(kindsOf(batch.drafts)).toEqual([EPrEventKind.Mergeability, EPrEventKind.Verdict])
    expect(batch.drafts[1]).toMatchObject({ verdict: EPrVerdict.Green })
  })

  it('delivers a merged state and then ends the subscription as completed', async () => {
    const { provider, intake, log, registry, subscribe } = wired()
    const subscription = await subscribe('owner/repo#7')

    provider.onFrame(merged())
    await settled()

    const batch = await intake.prepare({ threadId: MAIN })
    expect(batch.wakesTurn).toBe(true)
    expect(batch.drafts).toHaveLength(1)
    expect(batch.drafts[0]).toMatchObject({
      type: 'pr-event',
      kind: EPrEventKind.State,
      state: 'merged',
    })

    expect(log.ofType('subscription-ended', MAIN)).toHaveLength(0)
    batch.acknowledge()
    await settled()

    const ended = log.ofType('subscription-ended', MAIN)
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({
      subscriptionId: subscription.id,
      reason: ESubscriptionEnd.Completed,
    })
    expect(registry.list()).toEqual([])
    expect(provider.subscribed({ repo: 'github.com/owner/repo', number: 7 })).toBe(false)
  })

  it('delivers a subagent’s subscription to its owner thread', async () => {
    const { provider, intake, log, subscribe } = wired({ parents: new Map([[CHILD, MAIN]]) })
    const subscription = await subscribe('owner/repo#7', CHILD)
    expect(subscription.threadId).toBe(MAIN)
    expect(log.ofType('subscription-created', MAIN)).toHaveLength(1)

    provider.onFrame(failedVerdict())

    const child = await intake.prepare({ threadId: CHILD })
    expect(child.drafts).toEqual([])
    const owner = await intake.prepare({ threadId: MAIN })
    expect(owner.wakesTurn).toBe(true)
    expect(owner.drafts).toHaveLength(1)
    expect(owner.drafts[0]).toMatchObject({ type: 'pr-event', verdict: EPrVerdict.Failed })
  })
})
