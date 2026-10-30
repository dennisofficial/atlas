import { describe, expect, it } from 'bun:test'

import {
  EPrEventKind,
  EPrVerdict,
  authorListOf,
  toRunId,
  toThreadId,
  type IdPort,
} from '@dltech/atlas-core'

import type { PrEventFrame } from '../../cloud/pr-event-frame'
import {
  createPullRequestProvider,
  PULL_REQUEST_PROVIDER_KIND,
} from '../../plugins/github/pull-request-provider'
import { createPullRequestService } from '../../plugins/github/pull-request-service'
import { pullRequestsAnswering, wasFound } from '../../plugins/github/testing'
import { ESubscriptionActor } from '@dltech/atlas-core'
import { QUIET_WINDOW_MS } from '../delivery-buffer'
import { SubscriptionRegistry } from '../registry'
import { FakeClock } from './fake-schedule'
import { MemoryLog } from './memory-log'

const MAIN = toThreadId('main')
let sequence = 0

const frameOf = (args: { kind: EPrEventKind; payload: Partial<PrEventFrame['payload']> }) => {
  sequence += 1
  return {
    id: `f-${sequence}`,
    repoFullName: 'owner/repo',
    prNumber: 7,
    kind: args.kind,
    payload: { url: 'https://github.com/owner/repo/pull/7', ...args.payload },
    createdAt: 't',
  } satisfies PrEventFrame
}

const editBy = (args: { author: string; body: string; commentId?: string }) =>
  frameOf({
    kind: EPrEventKind.Comment,
    payload: {
      authorLogin: args.author,
      body: args.body,
      commentId: args.commentId ?? '10',
      edited: true,
    },
  })

const wired = async (urgent = '') => {
  const clock = new FakeClock()
  const provider = createPullRequestProvider({
    tracker: { checkoutFor: () => null },
    service: createPullRequestService({ pullRequests: pullRequestsAnswering(wasFound()) }),
    onTargets: () => undefined,
    probe: async () => null,
    editPolicy: () => ({ muted: authorListOf('vercel'), urgent: authorListOf(urgent) }),
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
  const registry = new SubscriptionRegistry({
    log: new MemoryLog(),
    ids,
    owners: { ownerOf: async ({ threadId }) => threadId },
    providers: [provider],
    now: clock.now,
    schedule: clock.schedule,
    newId: () => 'sub-1',
  })
  const outcome = await registry.subscribe({
    threadId: MAIN,
    provider: PULL_REQUEST_PROVIDER_KIND,
    input: 'owner/repo#7',
    projectDirectory: '/repo',
    by: ESubscriptionActor.Agent,
  })
  if (!outcome.ok) throw new Error(outcome.error)
  return { provider, clock, intake: registry.intakeSource }
}

const bodiesOf = (drafts: readonly { type: string }[]) =>
  drafts.map((draft) => ('body' in draft ? draft.body : undefined))

describe('edited comments through the subscription buffer', () => {
  it('delivers one draft with the latest body for repeated edits of one comment', async () => {
    const { provider, clock, intake } = await wired()

    for (const body of ['one', 'two', 'three']) {
      provider.onFrame(editBy({ author: 'chatgpt-codex-connector[bot]', body }))
    }
    clock.advance(QUIET_WINDOW_MS)

    const batch = await intake.prepare({ threadId: MAIN })
    expect(bodiesOf(batch.drafts)).toEqual(['three'])
    expect(batch.wakesTurn).toBe(true)
  })

  it('delivers nothing for a muted author', async () => {
    const { provider, clock, intake } = await wired()

    provider.onFrame(editBy({ author: 'vercel[bot]', body: 'deployed' }))
    clock.advance(QUIET_WINDOW_MS)

    expect((await intake.prepare({ threadId: MAIN })).drafts).toEqual([])
  })

  it('delivers a lone edit after a settled green verdict once the quiet window passes', async () => {
    const { provider, clock, intake } = await wired()

    provider.onFrame(
      frameOf({
        kind: EPrEventKind.Verdict,
        payload: { verdict: EPrVerdict.Green, headSha: 'abc' },
      }),
    )
    const first = await intake.prepare({ threadId: MAIN })
    expect(first.drafts).toHaveLength(1)
    first.acknowledge()

    provider.onFrame(editBy({ author: 'octocat', body: 'late edit' }))
    expect(intake.threadsAwaitingInput()).toEqual([])
    clock.advance(QUIET_WINDOW_MS)

    expect(intake.threadsAwaitingInput()).toEqual([MAIN])
    const batch = await intake.prepare({ threadId: MAIN })
    expect(bodiesOf(batch.drafts)).toEqual(['late edit'])
  })

  it('wakes immediately for an urgent author without advancing the clock', async () => {
    const { provider, intake } = await wired('octocat')

    provider.onFrame(editBy({ author: 'octocat', body: 'now' }))

    expect(intake.threadsAwaitingInput()).toEqual([MAIN])
    const batch = await intake.prepare({ threadId: MAIN })
    expect(bodiesOf(batch.drafts)).toEqual(['now'])
    expect(batch.wakesTurn).toBe(true)
  })
})
