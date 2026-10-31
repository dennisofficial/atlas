import { describe, expect, it } from 'bun:test'
import {
  EAgentStatus,
  ERunFailureKind,
  ERunRemedy,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'

import { EStepEnd } from '../../channel'
import { liveSteps, stepsOfSignalsAt } from '../in-flight-steps'
import {
  failedAgentsOf,
  runAttentionCopy,
  runAttentionOf,
  type RunAttention,
} from '../run-attention'
import { ended, log, started, stepOne } from './fixture'

const authFailure = { kind: ERunFailureKind.Auth, message: 'bad key' }

const failedLog = (extra: readonly EventDraft[] = []): Event[] =>
  log([{ type: 'user-said', text: 'go' }, { type: 'run-failed', failure: authFailure }, ...extra])

const idle = { working: false, turnInFlight: false, channelReady: true }

const attention = (args: {
  events: readonly Event[]
  signals?: Parameters<typeof stepsOfSignalsAt>[0]['signals']
  working?: boolean
  turnInFlight?: boolean
  channelReady?: boolean
}): RunAttention | null => {
  const live = liveSteps({
    steps: stepsOfSignalsAt({ signals: args.signals ?? [], now: undefined }),
    events: args.events,
  })
  return runAttentionOf({ ...idle, ...args, live })
}

const enabledOf = (value: RunAttention | null): Record<string, boolean> =>
  Object.fromEntries((value?.remedies ?? []).map((entry) => [entry.remedy, entry.enabled]))

describe('runAttentionOf failures', () => {
  it('offers every auth remedy when idle', () => {
    const value = attention({ events: failedLog() })
    expect(value?.failure?.kind).toBe(ERunFailureKind.Auth)
    expect(value?.failureSeq).toBe(2)
    expect(value?.dismissible).toBe(true)
    expect(value?.busyReason).toBeNull()
    expect(value?.remedies.map((entry) => entry.remedy)).toEqual([
      ERunRemedy.FixCredential,
      ERunRemedy.Retry,
      ERunRemedy.SwitchModel,
    ])
    expect(Object.values(enabledOf(value)).every(Boolean)).toBe(true)
  })

  it('disables Retry with a busy reason while a run is in flight', () => {
    const value = attention({ events: failedLog(), turnInFlight: true })
    expect(enabledOf(value)).toEqual({
      [ERunRemedy.FixCredential]: true,
      [ERunRemedy.Retry]: false,
      [ERunRemedy.SwitchModel]: true,
    })
    expect(value?.busyReason).toBe('Retry is unavailable while a run is in flight.')
  })

  it('disables Retry when the channel is not ready', () => {
    const value = attention({ events: failedLog(), channelReady: false })
    expect(enabledOf(value)[ERunRemedy.Retry]).toBe(false)
    expect(value?.busyReason).not.toBeNull()
  })

  it('disables Retry while settling', () => {
    const value = runAttentionOf({ ...idle, events: failedLog(), live: [], settling: true })
    expect(enabledOf(value)[ERunRemedy.Retry]).toBe(false)
  })

  it('is superseded by a later user-said', () => {
    expect(
      attention({ events: failedLog([{ type: 'user-said', text: 'again' }]) })?.failure,
    ).toBeNull()
  })

  it('is superseded by a later assistant-said', () => {
    expect(attention({ events: failedLog([{ type: 'assistant-said', parts: [] }]) })).toBeNull()
  })

  it('is superseded by a live running step', () => {
    expect(
      attention({ events: failedLog(), signals: [started(stepOne)], working: true }),
    ).toBeNull()
  })

  it('is hidden by its own dismissal, with no live signals', () => {
    const events = failedLog([{ type: 'run-failure-dismissed', failureSeq: 2 }])
    expect(attention({ events })).toBeNull()
  })

  it('ignores a dismissal of a different seq', () => {
    const events = failedLog([{ type: 'run-failure-dismissed', failureSeq: 1 }])
    expect(attention({ events })?.failureSeq).toBe(2)
  })

  it('reads a legacy turn-failed as an Other failure with Retry', () => {
    const events = log([
      { type: 'user-said', text: 'go' },
      { type: 'turn-failed', message: 'InvalidApiKey' },
    ])
    const value = attention({ events })
    expect(value).toMatchObject({
      failure: null,
      message: 'InvalidApiKey',
      failureSeq: 2,
      dismissible: true,
    })
    expect(value?.remedies).toEqual([{ remedy: ERunRemedy.Retry, enabled: true }])
  })

  it('shows nothing for a live Failed step once its durable failure is dismissed', () => {
    const signals = [
      started(stepOne),
      ended({ stepId: stepOne, end: EStepEnd.Failed, supersededBy: null }),
    ]
    const events = failedLog([{ type: 'run-failure-dismissed', failureSeq: 2 }])
    expect(attention({ events, signals })).toBeNull()
  })

  it('treats a live-only failure as not dismissible', () => {
    const value = attention({
      events: log([{ type: 'user-said', text: 'go' }]),
      signals: [
        started(stepOne),
        { type: 'chunk', stepId: stepOne, chunk: { type: 'error', message: 'boom' } },
        ended({ stepId: stepOne, end: EStepEnd.Failed, supersededBy: null }),
      ],
    })
    expect(value).toMatchObject({ failure: null, failureSeq: null, dismissible: false })
    expect(value?.remedies).toEqual([{ remedy: ERunRemedy.Retry, enabled: true }])
  })
})

describe('runAttentionOf interrupted runs', () => {
  const interrupted = () =>
    log([
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [] },
      { type: 'user-said', text: 'continue' },
    ])

  it('offers Resume when resumable and idle', () => {
    const value = attention({ events: interrupted() })
    expect(value).toMatchObject({ failure: null, failureSeq: 3, dismissible: true })
    expect(value?.remedies).toEqual([{ remedy: ERunRemedy.Resume, enabled: true }])
    expect(runAttentionCopy({ attention: value as RunAttention })).toEqual({
      title: 'The run stopped before finishing',
      detail: 'Resume continues from the last finished step; nothing is rerun.',
    })
  })

  it('makes the Resume strip dismissible at the last turn-taking event', () => {
    expect(attention({ events: interrupted() })).toMatchObject({ failureSeq: 3, dismissible: true })
  })

  it('closes the Resume strip with a dismissal and re-enables after a user-said', () => {
    const closed = log([
      { type: 'user-said', text: 'go' },
      { type: 'run-failure-dismissed', failureSeq: 1 },
    ])
    expect(attention({ events: closed })).toBeNull()
    const again = log([
      { type: 'user-said', text: 'go' },
      { type: 'run-failure-dismissed', failureSeq: 1 },
      { type: 'user-said', text: 'more' },
    ])
    expect(attention({ events: again })?.failureSeq).toBe(3)
  })

  it('closes a failure on a resumable log to nothing, not a Resume strip', () => {
    const events = failedLog([{ type: 'run-failure-dismissed', failureSeq: 2 }])
    expect(attention({ events })).toBeNull()
  })

  it('returns null when resumable but working', () => {
    expect(attention({ events: interrupted(), working: true })).toBeNull()
  })
})

describe('runAttentionCopy', () => {
  it('uses the failure copy', () => {
    const value = attention({ events: failedLog() }) as RunAttention
    expect(runAttentionCopy({ attention: value, providerLabel: 'Anthropic' }).title).toBe(
      'Anthropic rejected the API key',
    )
  })
})

describe('failedAgentsOf', () => {
  it('lists failed children since the last user message', () => {
    const events = log([
      {
        type: 'agent-ended',
        agentId: toThreadId('old'),
        agentType: 'explore',
        intent: 'old',
        status: EAgentStatus.Failed,
        failureKind: ERunFailureKind.Other,
      },
      { type: 'user-said', text: 'go' },
      {
        type: 'agent-ended',
        agentId: toThreadId('child'),
        agentType: 'explore',
        intent: 'look',
        status: EAgentStatus.Failed,
        failureKind: ERunFailureKind.Quota,
        failureCause: 'no credit',
      },
    ] as EventDraft[])
    expect(failedAgentsOf(events)).toEqual([
      {
        agentId: 'child',
        agentType: 'explore',
        intent: 'look',
        failureKind: ERunFailureKind.Quota,
        failureCause: 'no credit',
      },
    ])
    expect(attention({ events })?.failure?.kind).toBe(ERunFailureKind.AgentFailed)
  })
})

describe('runAttentionOf failed sub-agents', () => {
  const childFailed = (): EventDraft[] => [
    { type: 'user-said', text: 'go' },
    {
      type: 'agent-ended',
      agentId: toThreadId('child'),
      agentType: 'explore',
      intent: 'look',
      status: EAgentStatus.Failed,
      failureCause: 'no credit',
      failureKind: ERunFailureKind.Quota,
      prose: '',
      turns: 0,
      toolCalls: 0,
      relayed: false,
    },
  ]

  it('surfaces the failed agent with OpenAgent only', () => {
    expect(attention({ events: log(childFailed()) })).toMatchObject({
      failure: {
        kind: ERunFailureKind.AgentFailed,
        message: 'no credit',
        agent: { agentId: 'child', agentType: 'explore', intent: 'look' },
      },
      failureSeq: 2,
      dismissible: true,
      remedies: [{ remedy: ERunRemedy.OpenAgent, enabled: true }],
    })
  })

  it('is hidden by a dismissal of that ending', () => {
    const events = log([...childFailed(), { type: 'run-failure-dismissed', failureSeq: 2 }])
    expect(attention({ events })).toBeNull()
  })

  it('is superseded by a later user-said', () => {
    const events = log([...childFailed(), { type: 'user-said', text: 'next' }])
    expect(attention({ events })?.failure).toBeNull()
  })
})
