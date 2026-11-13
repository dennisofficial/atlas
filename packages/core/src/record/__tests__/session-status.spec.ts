import { describe, expect, it } from 'bun:test'

import { toAccountId } from '../../credentials/account'
import { toCallId, toEventId, toRunId, toThreadId } from '../../events/ids'
import { ERunFailureKind } from '../../events/run-failure'
import { EModelWaitCause, EWaitEpisodeKind } from '../../model-recovery/waiting'
import { EProviderFailureKind } from '../../models/provider-failure'
import { ERetryReason } from '../../models/retry'
import { EFinishReason } from '../../stream/chunk'
import { chainEvents } from '../chain-events'
import { EInputConsumed, type Hash, type V2Body, type V2Event } from '../event'
import { ESessionStatus, sessionStatusOf } from '../session-status'

const NOW = '2026-11-03T12:00:00.000Z'
const HASH = 'a'.repeat(64) as Hash
const THREAD = toThreadId('t')
const RUN = toRunId('r')
const CALL = toCallId('c1')

let seq = 0

const envelope = (): Pick<
  V2Event,
  'id' | 'seq' | 'threadId' | 'runId' | 'depth' | 'at' | 'epoch' | 'prevHash'
> => {
  seq += 1
  return {
    id: toEventId(`t:${seq}`),
    seq,
    threadId: THREAD,
    runId: RUN,
    depth: 0,
    at: NOW,
    epoch: 1,
    prevHash: HASH,
  }
}

const userSaid = (): V2Event => ({ ...envelope(), type: 'user-said', text: 'hi' })

const assistantSaid = (args: { aborted?: 'handoff'; finish?: EFinishReason } = {}): V2Event => ({
  ...envelope(),
  type: 'assistant-said',
  parts: [],
  aborted: args.aborted,
  finish: args.finish,
})

const toolDispatched = (args: { name?: string } = {}): V2Event => ({
  ...envelope(),
  type: 'tool-dispatched',
  callId: CALL,
  name: args.name ?? 'bash',
})

const toolResult = (args: { interrupted?: boolean } = {}): V2Event => ({
  ...envelope(),
  type: 'tool-result',
  callId: CALL,
  name: 'bash',
  interrupted: args.interrupted,
})

const toolResultError = (): V2Event => ({
  ...envelope(),
  type: 'tool-result',
  callId: CALL,
  name: 'operator_input',
  error: { message: 'the operator did not deliver a value' },
})

const operatorAsked = (): V2Event =>
  ({
    ...envelope(),
    type: 'operator-input-asked',
    requestId: 'oreq_1',
    kind: 'input',
    prompt: 'the login code',
    secret: true,
    expiresAt: '2026-11-03T12:15:00.000Z',
    sessionId: 's1',
  }) as unknown as V2Event

const operatorSettled = (): V2Event =>
  ({
    ...envelope(),
    type: 'operator-input-settled',
    requestId: 'oreq_1',
    outcome: 'abandoned',
    reason: 'abandoned',
    sessionId: 's1',
  }) as unknown as V2Event

const branchesObserved = (): V2Event => ({
  ...envelope(),
  type: 'branches-observed',
  repo: '/work',
  head: 'main',
  branches: [],
  worktrees: [],
})

const pullRequestLinked = (): V2Event => ({
  ...envelope(),
  type: 'pull-request-linked',
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  repo: 'o/r',
  branch: 'topic',
})

const inputConsumed = (consumed: EInputConsumed = EInputConsumed.Stop): V2Event => ({
  ...envelope(),
  type: 'input-consumed',
  inboxId: 7,
  consumed,
})

const otherFact = (): V2Event => ({
  ...envelope(),
  type: 'fact-recorded',
  key: 'note',
  kind: 'note',
})

const runFailed = (args: { message?: string } = {}): V2Event => ({
  ...envelope(),
  type: 'run-failed',
  failure: { kind: ERunFailureKind.Network, message: args.message ?? 'connection reset' },
})

const dismissFailure = (failure: V2Event): V2Event => ({
  ...envelope(),
  type: 'run-failure-dismissed',
  failureSeq: failure.seq,
})

const retry = (args: { notBefore: string }): V2Event => ({
  ...envelope(),
  type: 'retry-scheduled',
  key: 'retry:t:s0:1',
  notBefore: args.notBefore,
  attempt: 1,
  reason: ERetryReason.Network,
})

const retryLikeFact = (args: { notBefore: string }): V2Event => ({
  ...envelope(),
  type: 'fact-recorded',
  key: 'retry:model',
  kind: 'retry',
  value: { notBefore: args.notBefore },
})

const modelWaiting = (args: { reason?: string } = {}): V2Event => ({
  ...envelope(),
  type: 'model-waiting',
  waiting: {
    episode: {
      kind: EWaitEpisodeKind.Credential,
      key: { accountId: toAccountId('a'), providerId: 'openai', modelId: 'gpt-5' },
      generation: 1,
    },
    cause: EModelWaitCause.Availability,
    providerId: 'openai',
    accountId: 'a',
    modelId: null,
    reason: args.reason === undefined ? null : (args.reason as EProviderFailureKind),
    resetAt: null,
    affectedThreadIds: [THREAD],
  },
})

const waitCleared = (waiting: Extract<V2Event, { type: 'model-waiting' }>): V2Event => ({
  ...envelope(),
  type: 'model-wait-cleared',
  episode: waiting.waiting.episode,
  cause: waiting.waiting.cause,
})

const status = (args: {
  events?: readonly V2Event[]
  live?: boolean
  unconsumedInbox?: boolean
  now?: string
}) =>
  sessionStatusOf({
    events: args.events ?? [],
    live: args.live ?? false,
    unconsumedInbox: args.unconsumedInbox ?? false,
    now: args.now ?? NOW,
  })

describe('sessionStatusOf', () => {
  it('reports sent while an inbox entry is unconsumed, even mid-turn', () => {
    expect(status({ events: [userSaid()], unconsumedInbox: true })).toEqual({
      state: ESessionStatus.Sent,
    })
  })

  it('reports idle when there are no events yet', () => {
    expect(status({})).toEqual({ state: ESessionStatus.Idle, since: undefined })
  })

  it('reports idle after a finished turn', () => {
    const result = status({ events: [userSaid(), assistantSaid()], live: true })
    expect(result).toEqual({ state: ESessionStatus.Idle, since: NOW })
  })

  it('reports thinking while a turn is open under a live lease', () => {
    expect(status({ events: [userSaid()], live: true })).toEqual({
      state: ESessionStatus.Thinking,
      since: NOW,
    })
  })

  it('reports resuming on an unfinished turn with no live lease', () => {
    expect(status({ events: [userSaid()], live: false })).toEqual({
      state: ESessionStatus.Resuming,
      since: NOW,
    })
  })

  it('reports running-tool while a dispatched tool has no result', () => {
    const result = status({
      events: [userSaid(), toolDispatched({ name: 'bash' })],
      live: true,
    })
    expect(result).toEqual({ state: ESessionStatus.RunningTool, reason: 'bash', since: NOW })
  })

  it('returns to thinking once the tool result lands', () => {
    const result = status({
      events: [toolDispatched(), toolResult()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('reports waiting-to-retry on a retry-scheduled event with a future deadline', () => {
    const result = status({
      events: [userSaid(), retry({ notBefore: '2026-11-03T12:00:12.000Z' })],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.WaitingToRetry)
    expect(result.reason).toContain('12:00:12')
    expect(result.since).toBe(NOW)
  })

  it('ignores a retry-scheduled event whose deadline has passed', () => {
    const result = status({
      events: [userSaid(), retry({ notBefore: '2026-11-03T11:00:00.000Z' })],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('does not count a fact-recorded with a retry-like key and a future deadline', () => {
    const result = status({
      events: [userSaid(), retryLikeFact({ notBefore: '2026-11-03T12:00:12.000Z' })],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('keeps a retry-scheduled event neutral so it does not open or end a turn', () => {
    const result = status({
      events: [userSaid(), assistantSaid(), retry({ notBefore: '2026-11-03T12:00:12.000Z' })],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('reports waiting-for-credentials on an open credential wait', () => {
    const result = status({
      events: [userSaid(), modelWaiting({ reason: 'auth' })],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.WaitingForCredentials)
    expect(result.reason).toBe('auth')
  })

  it('clears waiting-for-credentials once the wait is cleared', () => {
    const waiting = modelWaiting()
    const cleared = waitCleared(waiting as Extract<V2Event, { type: 'model-waiting' }>)
    const result = status({ events: [waiting, cleared, assistantSaid()], live: true })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('reports failed on an unfinished run-failed', () => {
    const result = status({
      events: [userSaid(), runFailed({ message: 'connection reset' })],
      live: false,
    })
    expect(result).toEqual({
      state: ESessionStatus.Failed,
      reason: 'connection reset',
      since: NOW,
    })
  })

  it('is not failed when a user-said follows the run-failed', () => {
    const result = status({
      events: [runFailed(), userSaid()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('treats a dismissed failure as failed only when the turn never restarted', () => {
    const failed = runFailed({ message: 'boom' })
    const dismissed = status({ events: [failed, dismissFailure(failed)], live: false })
    expect(dismissed.state).toBe(ESessionStatus.Failed)

    const restarted = status({
      events: [failed, dismissFailure(failed), userSaid()],
      live: true,
    })
    expect(restarted.state).toBe(ESessionStatus.Thinking)
  })

  it('reports resuming after a handoff-aborted assistant message with no live lease', () => {
    const result = status({ events: [assistantSaid({ aborted: 'handoff' })], live: false })
    expect(result.state).toBe(ESessionStatus.Resuming)
  })

  it('reports thinking after a handoff-aborted assistant message under a live lease', () => {
    const result = status({ events: [assistantSaid({ aborted: 'handoff' })], live: true })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })
})

describe('sessionStatusOf a step finish reason', () => {
  it('keeps the turn open when the step ended in tool calls', () => {
    const events = [userSaid(), assistantSaid({ finish: EFinishReason.ToolCalls })]
    expect(status({ events, live: true })).toEqual({ state: ESessionStatus.Thinking, since: NOW })
    expect(status({ events, live: false })).toEqual({ state: ESessionStatus.Resuming, since: NOW })
  })

  it('ends the turn when the step stopped', () => {
    const events = [userSaid(), assistantSaid({ finish: EFinishReason.Stop })]
    expect(status({ events, live: true })).toEqual({ state: ESessionStatus.Idle, since: NOW })
  })

  it('ends the turn for a row recorded before finish existed', () => {
    const events = [userSaid(), assistantSaid()]
    expect(status({ events, live: false })).toEqual({ state: ESessionStatus.Idle, since: NOW })
  })

  it('stays thinking through the tool round that follows', () => {
    const events = [
      userSaid(),
      assistantSaid({ finish: EFinishReason.ToolCalls }),
      toolDispatched(),
      toolResult(),
    ]
    expect(status({ events, live: true }).state).toBe(ESessionStatus.Thinking)
  })
})

describe('sessionStatusOf record-only events after the turn', () => {
  it('reports idle when the host links a pull request after the reply', () => {
    const result = status({
      events: [userSaid(), assistantSaid(), branchesObserved(), pullRequestLinked()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('reports idle when branches-observed follows the reply', () => {
    const result = status({
      events: [userSaid(), assistantSaid(), branchesObserved()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('reports idle when a fact follows the reply', () => {
    const result = status({
      events: [userSaid(), assistantSaid(), otherFact()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('reports idle after an interrupted tool-result and the stop being consumed', () => {
    const result = status({
      events: [userSaid(), toolDispatched(), toolResult({ interrupted: true }), inputConsumed()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('reports idle when a stop is consumed before the turn recorded anything', () => {
    const result = status({
      events: [userSaid(), inputConsumed()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('reports idle when the stop is consumed and branches are observed after it', () => {
    const result = status({
      events: [userSaid(), toolResult({ interrupted: true }), inputConsumed(), branchesObserved()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('stays thinking when branches are observed mid-turn', () => {
    const result = status({
      events: [userSaid(), branchesObserved()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('keeps running-tool when a fact follows the dispatch', () => {
    const result = status({
      events: [userSaid(), toolDispatched(), otherFact()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.RunningTool)
  })

  it('stays thinking when a malformed inbox entry is discarded after a tool result', () => {
    const result = status({
      events: [userSaid(), toolDispatched(), toolResult(), inputConsumed(EInputConsumed.Discarded)],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('stays running-tool when an entry is discarded while a tool runs', () => {
    const result = status({
      events: [userSaid(), toolDispatched(), inputConsumed(EInputConsumed.Discarded)],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.RunningTool)
  })

  it('reports idle when an explicit stop is consumed while a tool runs', () => {
    const result = status({
      events: [userSaid(), toolDispatched(), inputConsumed(EInputConsumed.Stop)],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Idle)
  })

  it('starts a new turn when a message is consumed with its user-said', () => {
    const result = status({
      events: [userSaid(), assistantSaid(), inputConsumed(), userSaid()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Thinking)
  })

  it('keeps failed when record-only events follow the failure', () => {
    const result = status({
      events: [userSaid(), runFailed(), branchesObserved()],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Failed)
  })

  it('keeps running-tool while the request it asked the operator for settles', () => {
    const result = status({
      events: [
        userSaid(),
        toolDispatched({ name: 'operator_input' }),
        operatorAsked(),
        operatorSettled(),
      ],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.RunningTool)
  })

  it('keeps failed when an abandoned request and its erased tool result trail the failure', () => {
    const result = status({
      events: [
        userSaid(),
        toolDispatched({ name: 'operator_input' }),
        operatorAsked(),
        runFailed(),
        operatorSettled(),
        toolResultError(),
      ],
      live: true,
    })
    expect(result.state).toBe(ESessionStatus.Failed)
  })
})

describe('sessionStatusOf workspace preparation', () => {
  const chained = (bodies: V2Body[]): V2Event[] =>
    chainEvents({ threadId: THREAD, runId: RUN, epoch: 1, at: NOW, bodies })
  const failed = (inboxHead: number): V2Body => ({
    type: 'workspace-prepare-failed',
    reason: 'clone failed',
    inboxHead,
  })
  const tracked = (args: { bodies: V2Body[]; pending?: number[]; retry?: boolean }) =>
    sessionStatusOf({
      events: chained(args.bodies),
      live: true,
      unconsumedInbox: (args.pending ?? []).length > 0,
      messageAfterFailure: args.retry ?? false,
      now: NOW,
    })

  it('reports preparing for a new session, with or without a message', () => {
    expect(tracked({ bodies: [] }).state).toBe(ESessionStatus.Preparing)
    expect(tracked({ bodies: [], pending: [1] }).state).toBe(ESessionStatus.Preparing)
  })

  it('reports setup-failed with the reason until a newer message arrives', () => {
    expect(tracked({ bodies: [failed(1)], pending: [1] })).toEqual({
      state: ESessionStatus.SetupFailed,
      reason: 'clone failed',
      since: NOW,
    })
    expect(tracked({ bodies: [failed(1)], pending: [1, 2], retry: true }).state).toBe(
      ESessionStatus.Preparing,
    )
  })

  it('leaves a prepared session to the ordinary rules', () => {
    const bodies: V2Body[] = [{ type: 'workspace-prepared' }]
    expect(tracked({ bodies }).state).toBe(ESessionStatus.Idle)
    expect(tracked({ bodies, pending: [1] }).state).toBe(ESessionStatus.Sent)
  })

  it('is idle, not failed, after a prepare that finished with warnings', () => {
    const bodies: V2Body[] = [
      { type: 'sandbox-setup-reported', text: 'clone failed', failed: true },
      { type: 'workspace-prepared', warnings: ['clone failed'] },
    ]
    expect(tracked({ bodies }).state).toBe(ESessionStatus.Idle)
    expect(tracked({ bodies, pending: [1] }).state).toBe(ESessionStatus.Sent)
  })

  it('treats a session with turns but no prepare event as prepared', () => {
    const bodies: V2Body[] = [{ type: 'user-said', text: 'hi' }]
    expect(tracked({ bodies }).state).toBe(ESessionStatus.Thinking)
  })
})
