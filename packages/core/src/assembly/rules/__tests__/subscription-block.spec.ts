import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../../events/body'
import { contextFor, log } from '../../__tests__/log-fixture'
import type { Assembled } from '../../assembled'
import {
  ESubscriptionActor,
  ESubscriptionEnd,
  ESubscriptionStatus,
} from '../../../subscriptions/subscription'
import { messagesFromEvents } from '../messages-from-events'

const created = (createdBy: ESubscriptionActor): EventDraft => ({
  type: 'subscription-created',
  subscriptionId: 'sub_1',
  provider: 'github.pull-request',
  target: { number: 7 },
  label: 'PR #7',
  createdBy,
})

const render = (drafts: readonly EventDraft[]): string[] => {
  const events = log(drafts)
  const empty: Assembled = { system: [], messages: [] }
  const assembled = messagesFromEvents()(empty, contextFor({ events }))
  return assembled.messages.flatMap(({ message }) =>
    message.content.flatMap((part) =>
      typeof part === 'object' && 'text' in part ? [part.text] : [],
    ),
  )
}

describe('telling the model about subscription changes it did not make', () => {
  it('says the operator subscribed the thread', () => {
    const [text] = render([created(ESubscriptionActor.Operator)])

    expect(text).toBe(
      '<system-notice kind="subscription">\nThe operator subscribed this thread to PR #7 (github.pull-request), subscription sub_1.\n</system-notice>',
    )
  })

  it('says the operator paused and resumed, by label', () => {
    const texts = render([
      created(ESubscriptionActor.Agent),
      {
        type: 'subscription-changed',
        subscriptionId: 'sub_1',
        status: ESubscriptionStatus.Paused,
        by: ESubscriptionActor.Operator,
      },
      {
        type: 'subscription-changed',
        subscriptionId: 'sub_1',
        status: ESubscriptionStatus.Active,
        by: ESubscriptionActor.Operator,
      },
    ])

    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('The operator paused PR #7, subscription sub_1.')
    expect(texts[1]).toContain('The operator resumed PR #7, subscription sub_1.')
  })

  it('says why a subscription ended when the agent did not end it', () => {
    const texts = render([
      created(ESubscriptionActor.Agent),
      {
        type: 'subscription-ended',
        subscriptionId: 'sub_1',
        reason: ESubscriptionEnd.Completed,
        by: ESubscriptionActor.Provider,
      },
      {
        type: 'subscription-ended',
        subscriptionId: 'sub_1',
        reason: ESubscriptionEnd.Expired,
        by: ESubscriptionActor.Clock,
      },
      {
        type: 'subscription-ended',
        subscriptionId: 'sub_1',
        reason: ESubscriptionEnd.Unsubscribed,
        by: ESubscriptionActor.Operator,
      },
    ])

    expect(texts[0]).toContain('Subscription sub_1 to PR #7 ended: completed.')
    expect(texts[1]).toContain('ended: expired.')
    expect(texts[2]).toContain('ended: removed by the operator.')
  })

  it('falls back to the id when the creation is not in the log', () => {
    const [text] = render([
      {
        type: 'subscription-ended',
        subscriptionId: 'sub_9',
        reason: ESubscriptionEnd.Expired,
        by: ESubscriptionActor.Clock,
      },
    ])

    expect(text).toContain('Subscription sub_9 to sub_9 ended: expired.')
  })

  it('stays silent about what the agent did itself', () => {
    const texts = render([
      created(ESubscriptionActor.Agent),
      {
        type: 'subscription-changed',
        subscriptionId: 'sub_1',
        status: ESubscriptionStatus.Paused,
        by: ESubscriptionActor.Agent,
      },
      {
        type: 'subscription-ended',
        subscriptionId: 'sub_1',
        reason: ESubscriptionEnd.Unsubscribed,
        by: ESubscriptionActor.Agent,
      },
    ])

    expect(texts).toEqual([])
  })
})
