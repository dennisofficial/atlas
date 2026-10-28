import {
  ENoticeTone,
  ESubscriptionActor,
  ESubscriptionStatus,
  type NoticePost,
} from '@dltech/atlas-core'
import {
  PULL_REQUEST_PROVIDER_KIND,
  SubscriptionRegistryPort,
  type SubscribeOutcome,
} from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { createSubscriptionActions, inputOf } from '../actions'
import { REPO, THREAD, view } from './fixtures'

class FakeRegistry extends SubscriptionRegistryPort {
  calls: unknown[] = []
  outcome: SubscribeOutcome = { ok: true, subscription: view(), existed: false }
  succeeds = true
  list = () => []
  providers = () => []
  version = () => 0
  onChange = () => () => undefined
  async subscribe(args: Parameters<SubscriptionRegistryPort['subscribe']>[0]) {
    this.calls.push(['subscribe', args])
    return this.outcome
  }
  async setStatus(args: Parameters<SubscriptionRegistryPort['setStatus']>[0]) {
    this.calls.push(['setStatus', args])
    return this.succeeds
  }
  async unsubscribe(args: Parameters<SubscriptionRegistryPort['unsubscribe']>[0]) {
    this.calls.push(['unsubscribe', args])
    return this.succeeds
  }
}

const harness = () => {
  const registry = new FakeRegistry()
  const notices: NoticePost[] = []
  const actions = createSubscriptionActions({
    registry: () => registry,
    notice: { notify: (post) => notices.push(post) },
  })
  return { registry, notices, actions }
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

const ring = (existing: ReturnType<typeof view> | null) => ({
  threadId: THREAD,
  repo: REPO,
  number: 7,
  projectDirectory: '/work',
  existing,
})

describe('inputOf', () => {
  it('turns a repo string into the owner/repo#n shorthand', () => {
    expect(inputOf({ repo: REPO, number: 7 })).toBe('o/r#7')
  })
})

describe('subscription actions', () => {
  it('subscribes the visible thread as the operator when the bell is hollow', async () => {
    const { registry, actions } = harness()
    actions.ring(ring(null))
    await settled()

    expect(registry.calls).toEqual([
      [
        'subscribe',
        {
          threadId: THREAD,
          provider: PULL_REQUEST_PROVIDER_KIND,
          input: 'o/r#7',
          projectDirectory: '/work',
          by: ESubscriptionActor.Operator,
        },
      ],
    ])
  })

  it('unsubscribes when the bell is filled', async () => {
    const { registry, actions } = harness()
    actions.ring(ring(view()))
    await settled()

    expect(registry.calls).toEqual([
      ['unsubscribe', { subscriptionId: 'sub-1', by: ESubscriptionActor.Operator }],
    ])
  })

  it('pauses an active subscription and resumes a paused one', async () => {
    const { registry, actions } = harness()
    actions.toggle(view())
    actions.toggle(view({ status: ESubscriptionStatus.Paused }))
    await settled()

    expect(registry.calls).toEqual([
      [
        'setStatus',
        {
          subscriptionId: 'sub-1',
          status: ESubscriptionStatus.Paused,
          by: ESubscriptionActor.Operator,
        },
      ],
      [
        'setStatus',
        {
          subscriptionId: 'sub-1',
          status: ESubscriptionStatus.Active,
          by: ESubscriptionActor.Operator,
        },
      ],
    ])
  })

  it('posts the port error as a warning notice', async () => {
    const { registry, notices, actions } = harness()
    registry.outcome = { ok: false, error: 'No such pull request' }
    actions.ring(ring(null))
    await settled()

    expect(notices).toEqual([
      { text: 'No such pull request', tone: ENoticeTone.Warn, key: 'subscriptions' },
    ])
  })

  it('says so when the subscription was already gone', async () => {
    const { registry, notices, actions } = harness()
    registry.succeeds = false
    actions.remove(view())
    await settled()

    expect(notices[0]?.text).toBe('subscription already gone')
  })
})
