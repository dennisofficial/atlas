import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  ESubscriptionActor,
  ESubscriptionStatus,
  ESubscriptionTone,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'

import type { SubscriptionPresentationInput } from '@dltech/atlas-core'

import { githubPresenters, presentPullRequest, presentWorkflowRun, subscriptionsOfEvents } from '..'

const input = (
  overrides: Partial<SubscriptionPresentationInput> = {},
): SubscriptionPresentationInput => ({
  provider: 'github.pull-request',
  label: 'owner/atlas#4',
  target: { repo: 'github.com/owner/atlas', number: 4 },
  status: ESubscriptionStatus.Active,
  events: [],
  ...overrides,
})

const eventsOf = (bodies: RecordEventBody[]) =>
  chainEvents({
    threadId: toThreadId('t1'),
    runId: toRunId('r1'),
    epoch: 1,
    at: '2026-11-08T10:00:00.000Z',
    bodies,
  })

const created = (body: Record<string, unknown>): RecordEventBody =>
  ({ type: 'subscription-created', ...body }) as RecordEventBody

describe('github pull request presentation', () => {
  it('names the pull request and says it watches every event', () => {
    expect(presentPullRequest(input())).toEqual({
      icon: 'git-pull-request',
      tone: ESubscriptionTone.Open,
      title: 'owner/atlas#4',
      meta: ['Pull request', 'all events'],
    })
  })

  it('summarises a filter in catalog order, spelling CI', () => {
    expect(presentPullRequest(input({ events: ['ci', 'comments'] })).meta).toEqual([
      'Pull request',
      'comments · CI',
    ])
    expect(presentPullRequest(input({ events: ['state'] })).meta).toEqual(['Pull request', 'state'])
  })

  it('falls back to neutral when the target is not a pull request', () => {
    expect(presentPullRequest(input({ target: { repo: 'github.com/owner/atlas' } }))).toMatchObject(
      {
        icon: 'bell',
        tone: ESubscriptionTone.Neutral,
      },
    )
  })
})

describe('github workflow run presentation', () => {
  it('titles a workflow selector by workflow and branch', () => {
    expect(
      presentWorkflowRun(
        input({
          provider: 'github.workflow-run',
          label: 'owner/atlas deploy.yml@main',
          target: {
            kind: 'selector',
            repo: 'github.com/owner/atlas',
            workflow: 'deploy.yml',
            branch: 'main',
          },
        }),
      ),
    ).toEqual({
      icon: 'circle-play',
      tone: ESubscriptionTone.Running,
      title: 'deploy.yml@main',
      meta: ['Workflow run'],
    })
  })

  it('titles a single run by its id', () => {
    const presentation = presentWorkflowRun(
      input({
        provider: 'github.workflow-run',
        label: 'owner/atlas#42',
        target: { kind: 'run', repo: 'github.com/owner/atlas', runId: 42 },
      }),
    )
    expect(presentation.title).toBe('run 42')
    expect(presentation.tone).toBe(ESubscriptionTone.Running)
  })
})

describe('subscription rows carry their presentation', () => {
  it('presents a created pull request row from the fold', () => {
    const [row] = subscriptionsOfEvents(
      eventsOf([
        created({
          subscriptionId: 'a',
          provider: 'github.pull-request',
          target: { repo: 'github.com/owner/atlas', number: 4 },
          label: 'owner/atlas#4',
          threadId: 't1',
          createdBy: ESubscriptionActor.Agent,
        }),
      ]),
    )
    expect(row?.presentation).toEqual({
      icon: 'git-pull-request',
      tone: ESubscriptionTone.Open,
      title: 'owner/atlas#4',
      meta: ['Pull request', 'all events'],
    })
    expect(row?.held).toBe(0)
  })

  it('keeps the presentation of a workflow run and a neutral one for an unknown provider', () => {
    const [run, other] = subscriptionsOfEvents(
      eventsOf([
        created({
          subscriptionId: 'run',
          provider: 'github.workflow-run',
          target: {
            kind: 'selector',
            repo: 'github.com/owner/atlas',
            workflow: 'deploy.yml',
            branch: 'main',
          },
          label: 'owner/atlas deploy.yml@main',
          threadId: 't1',
          createdBy: ESubscriptionActor.Agent,
        }),
        created({
          subscriptionId: 'other',
          provider: 'slack.channel',
          target: { channel: 'x' },
          label: 'x',
          threadId: 't1',
          createdBy: ESubscriptionActor.Agent,
        }),
      ]),
    )
    expect(run?.presentation).toMatchObject({ icon: 'circle-play', title: 'deploy.yml@main' })
    expect(other?.presentation).toEqual({
      icon: 'bell',
      tone: ESubscriptionTone.Neutral,
      title: 'x',
      meta: [],
    })
  })

  it('keeps a row and its presentation when an older log carries a status change', () => {
    const [changed] = subscriptionsOfEvents(
      eventsOf([
        created({
          subscriptionId: 'a',
          provider: 'github.pull-request',
          target: { repo: 'github.com/owner/atlas', number: 4 },
          label: 'owner/atlas#4',
          threadId: 't1',
          createdBy: ESubscriptionActor.Agent,
        }),
        {
          type: 'subscription-changed',
          subscriptionId: 'a',
          status: ESubscriptionStatus.Paused,
          by: ESubscriptionActor.Operator,
        },
      ]),
    )
    expect(changed?.presentation.icon).toBe('git-pull-request')
    expect(changed?.held).toBe(0)
  })

  it('exposes both providers in its presenter map', () => {
    expect(Object.keys(githubPresenters).sort()).toEqual([
      'github.pull-request',
      'github.workflow-run',
    ])
  })
})
