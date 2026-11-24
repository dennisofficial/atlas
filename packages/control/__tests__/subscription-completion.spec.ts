import { describe, expect, it } from 'bun:test'

import {
  EPrEventKind,
  EPullRequestState,
  ESubscriptionActor,
  ESubscriptionEnd,
  ETargetPhase,
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  inboxEventOf,
  type EventBody,
  type SubscriptionTargetState,
} from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing/memory'
import { MAIN, NOW, REPO, SESSION, pullRequestLease } from './subscription-fixtures'

const MERGED_NOTICE: EventBody = {
  type: 'pr-event',
  repo: REPO,
  prNumber: 7,
  kind: EPrEventKind.State,
  url: 'https://github.com/acme/atlas/pull/7',
  state: EPullRequestState.Merged,
}

const MERGED: SubscriptionTargetState = {
  phase: ETargetPhase.Terminal,
  summary: 'Pull request acme/atlas#7 is already merged.',
  notice: MERGED_NOTICE,
}

const OPEN: SubscriptionTargetState = {
  phase: ETargetPhase.Open,
  summary: 'Pull request acme/atlas#7 is open.',
  snapshot: {
    facts: [
      'ready for review, head a1b2c3d',
      'CI finished, all checks passed (3 passed, 0 failed, 0 running)',
    ],
    next: 'No CI notice comes for this head.',
  },
}

const setup = async (state: SubscriptionTargetState | undefined) => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const reads: string[] = []
  const plane = new ControlPlane({
    store,
    clock: () => NOW,
    ...(state === undefined
      ? {}
      : {
          targetStates: {
            read: async ({ userId, provider }) => {
              reads.push(`${userId}|${provider}`)
              return state
            },
          },
        }),
  })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: MAIN,
  })
  return { store, plane, reads }
}

const subscribe = (plane: ControlPlane) =>
  plane.subscribe({
    sessionId: SESSION,
    threadId: MAIN,
    provider: 'github.pull-request',
    target: { repo: REPO, number: 7 },
    label: 'acme/atlas#7',
    events: [],
    lease: pullRequestLease(7),
    by: ESubscriptionActor.Agent,
  })

const inboxOf = async (plane: ControlPlane) => {
  const entries = await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 100 })
  return entries.flatMap((entry) => {
    const read = inboxEventOf(entry.payload)
    return read.ok ? [{ kind: entry.kind, event: read.event }] : []
  })
}

describe('subscribing to a target that already reached its end', () => {
  it('delivers the terminal notice and ends the subscription in the same call', async () => {
    const { plane, reads } = await setup(MERGED)

    const result = await subscribe(plane)

    expect(reads).toEqual(['user-a|github.pull-request'])
    expect(result.target).toEqual({
      phase: ETargetPhase.Terminal,
      summary: 'Pull request acme/atlas#7 is already merged.',
      ended: true,
    })
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([])
    const inbox = await inboxOf(plane)
    expect(inbox.map((entry) => [entry.kind, entry.event.type])).toEqual([
      [INBOX_KIND_RECORD, 'subscription-created'],
      [INBOX_KIND_EVENT, 'pr-event'],
      [INBOX_KIND_RECORD, 'subscription-ended'],
    ])
    expect(inbox[1]?.event).toMatchObject(MERGED_NOTICE)
    expect(inbox[2]?.event).toMatchObject({
      subscriptionId: result.subscription.id,
      reason: ESubscriptionEnd.Completed,
      by: ESubscriptionActor.Provider,
    })
  })

  it('keeps an open target subscribed and names its state', async () => {
    const { plane } = await setup(OPEN)

    const result = await subscribe(plane)

    expect(result.target).toEqual({
      phase: ETargetPhase.Open,
      summary: 'Pull request acme/atlas#7 is open.',
      snapshot: OPEN.snapshot,
      ended: false,
    })
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toHaveLength(1)
    expect((await inboxOf(plane)).map((entry) => entry.event.type)).toEqual([
      'subscription-created',
    ])
  })

  it('subscribes as before when no state reader is wired', async () => {
    const { plane } = await setup(undefined)

    const result = await subscribe(plane)

    expect(result.target).toBeUndefined()
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toHaveLength(1)
  })

  it('delivers the terminal notice once per subscribe call', async () => {
    const { plane } = await setup(MERGED)

    const first = await subscribe(plane)
    const second = await subscribe(plane)

    expect(second.subscription.id).not.toBe(first.subscription.id)
    expect((await inboxOf(plane)).filter((entry) => entry.event.type === 'pr-event')).toHaveLength(
      2,
    )
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([])
  })
})
