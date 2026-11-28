import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionTone } from '@dltech/atlas-core'
import type { SessionSubscription } from '@dltech/atlas-protocol'

import { subscriptionRowsOf } from '../subscription-rows'

const subscriptionOf = (overrides: Partial<SessionSubscription> = {}): SessionSubscription => ({
  id: 'sub_7',
  threadId: 't1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/owner/atlas', number: 7 },
  label: 'owner/atlas#7',
  events: [],
  createdBy: 'agent',
  createdAt: '2026-11-08T10:00:00.000Z',
  ...overrides,
})

describe('subscriptionRowsOf', () => {
  it('titles a pull request row with its label and shows all events', () => {
    expect(subscriptionRowsOf({ subscriptions: [subscriptionOf()], pullRequests: [] })).toEqual([
      {
        id: 'sub_7',
        createdBy: ESubscriptionActor.Agent,
        target: { repo: 'github.com/owner/atlas', number: 7 },
        presentation: {
          icon: 'git-pull-request',
          tone: ESubscriptionTone.Open,
          title: 'owner/atlas#7',
          meta: ['Pull request', 'all events'],
        },
      },
    ])
  })

  it('titles a row from its target when it carries no label', () => {
    const [row] = subscriptionRowsOf({
      subscriptions: [subscriptionOf({ label: '' })],
      pullRequests: [],
    })
    expect(row?.presentation.title).toBe('owner/atlas#7')
  })

  it('names the events the row follows', () => {
    const [row] = subscriptionRowsOf({
      subscriptions: [subscriptionOf({ events: ['ci', 'comments'] })],
      pullRequests: [],
    })
    expect(row?.presentation.meta).toEqual(['Pull request', 'comments, CI'])
  })

  it('takes the title and state of the linked pull request', () => {
    const [row] = subscriptionRowsOf({
      subscriptions: [subscriptionOf()],
      pullRequests: [{ number: 7, title: 'Fix it', state: 'merged' }],
    })
    expect(row?.presentation).toEqual({
      icon: 'git-merge',
      tone: ESubscriptionTone.Merged,
      title: '#7 Fix it',
      meta: ['Pull request', 'all events'],
    })
  })

  it('marks a draft pull request neutral', () => {
    const [row] = subscriptionRowsOf({
      subscriptions: [subscriptionOf()],
      pullRequests: [{ number: 7, title: 'Wip', state: 'draft' }],
    })
    expect(row?.presentation.icon).toBe('git-pull-request-draft')
    expect(row?.presentation.tone).toBe(ESubscriptionTone.Neutral)
  })

  it('leaves a row alone when no linked pull request matches it', () => {
    const [row] = subscriptionRowsOf({
      subscriptions: [subscriptionOf()],
      pullRequests: [{ number: 8, title: 'Other', state: 'closed' }],
    })
    expect(row?.presentation.title).toBe('owner/atlas#7')
    expect(row?.presentation.tone).toBe(ESubscriptionTone.Open)
  })

  it('titles a workflow run row with its selector', () => {
    const [row] = subscriptionRowsOf({
      subscriptions: [
        subscriptionOf({
          id: 'sub_run',
          provider: 'github.workflow-run',
          target: {
            kind: 'selector',
            repo: 'github.com/owner/atlas',
            workflow: 'deploy.yml',
            branch: 'main',
          },
          label: 'deploy.yml@main',
          events: [],
          createdBy: 'operator',
        }),
      ],
      pullRequests: [],
    })
    expect(row?.presentation).toEqual({
      icon: 'circle-play',
      tone: ESubscriptionTone.Running,
      title: 'deploy.yml@main',
      meta: ['Workflow run'],
    })
    expect(row?.createdBy).toBe(ESubscriptionActor.Operator)
  })

  it('reads an unknown actor as the agent', () => {
    const [row] = subscriptionRowsOf({
      subscriptions: [subscriptionOf({ createdBy: 'probe' })],
      pullRequests: [],
    })
    expect(row?.createdBy).toBe(ESubscriptionActor.Agent)
  })
})
