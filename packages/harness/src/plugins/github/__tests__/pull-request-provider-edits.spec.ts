import { describe, expect, it } from 'bun:test'

import {
  authorListOf,
  DEFAULT_PR_EDIT_POLICY,
  EPrEventKind,
  type PrEditPolicy,
} from '@dltech/atlas-core'

import { EOccurrenceUrgency } from '../../../subscriptions/provider'
import { createPullRequestProvider, occurrenceOf } from '../pull-request-provider'
import { createPullRequestService } from '../pull-request-service'
import { pullRequestsAnswering, wasFound } from '../testing'
import type { SubscriptionOccurrence } from '../../../subscriptions/provider'
import { frame, subscription } from './provider-fixtures'

const policyOf = (args: { muted?: string; urgent?: string }): PrEditPolicy => ({
  muted: authorListOf(args.muted ?? ''),
  urgent: authorListOf(args.urgent ?? ''),
})

const edit = (args: { author: string; commentId?: string; kind?: EPrEventKind }) =>
  frame({
    kind: args.kind ?? EPrEventKind.Comment,
    payload: {
      authorLogin: args.author,
      commentId: args.commentId ?? '10',
      edited: true,
      body: 'changed',
    },
  })

const providerWith = (editPolicy: () => PrEditPolicy) => {
  const provider = createPullRequestProvider({
    tracker: { checkoutFor: () => null },
    service: createPullRequestService({ pullRequests: pullRequestsAnswering(wasFound()) }),
    onTargets: () => undefined,
    probe: async () => null,
    editPolicy,
  })
  const emitted: SubscriptionOccurrence[] = []
  provider.start({ subscription: subscription(), emit: (o) => emitted.push(o) })
  return { provider, emitted }
}

describe('occurrenceOf for edited comments', () => {
  it('drops a muted bot edit whether or not the login carries [bot]', () => {
    const policy = policyOf({ muted: 'vercel' })

    expect(occurrenceOf({ frame: edit({ author: 'vercel[bot]' }), policy })).toBeNull()
    expect(occurrenceOf({ frame: edit({ author: 'vercel' }), policy })).toBeNull()
  })

  it("batches a person's edit under a per-comment key", () => {
    const occurrence = occurrenceOf({ frame: edit({ author: 'octocat' }), policy: policyOf({}) })

    expect(occurrence).toMatchObject({
      key: 'comment-edit:10',
      urgency: EOccurrenceUrgency.Batch,
    })
  })

  it('wakes at once for an urgent author, on the same key', () => {
    const occurrence = occurrenceOf({
      frame: edit({ author: 'chatgpt-codex-connector[bot]', kind: EPrEventKind.ReviewComment }),
      policy: policyOf({ urgent: 'chatgpt-codex-connector' }),
    })

    expect(occurrence).toMatchObject({
      key: 'comment-edit:10',
      urgency: EOccurrenceUrgency.Now,
    })
  })

  it('leaves a created comment immediate and keyed by frame id', () => {
    const created = frame({ kind: EPrEventKind.Comment, payload: { commentId: '10' } })

    expect(occurrenceOf({ frame: created })).toMatchObject({
      key: created.id,
      urgency: EOccurrenceUrgency.Now,
    })
  })

  it('defaults to the built-in policy when none is given', () => {
    expect(occurrenceOf({ frame: edit({ author: 'netlify[bot]' }) })).toBeNull()
    expect(DEFAULT_PR_EDIT_POLICY.muted.has('netlify')).toBe(true)
  })
})

describe('the provider with an edit policy', () => {
  it('emits nothing for a muted edit', () => {
    const { provider, emitted } = providerWith(() => policyOf({ muted: 'vercel' }))

    provider.onFrame(edit({ author: 'vercel[bot]' }))

    expect(emitted).toEqual([])
  })

  it('reads the policy on every frame', () => {
    let policy = policyOf({})
    const { provider, emitted } = providerWith(() => policy)

    provider.onFrame(edit({ author: 'octocat' }))
    policy = policyOf({ muted: 'octocat' })
    provider.onFrame(edit({ author: 'octocat' }))

    expect(emitted).toHaveLength(1)
  })
})
