import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EWorkspaceRepoState,
  EWorkspaceStep,
  EWorkspaceStepState,
  ESessionStatus,
  sessionStatusOf,
  toRunId,
  toThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import { EBootStepState } from '@dltech/atlas-wire/web'

import { sessionBootViewOf } from '../session-boot-view'

const TIMEOUT = 'the sandbox did not answer within 60s'

const step = (
  attempt: number,
  name: EWorkspaceStep,
  state: EWorkspaceStepState,
  extra: Partial<
    Omit<Extract<RecordEventBody, { type: 'workspace-step' }>, 'type' | 'step' | 'state'>
  > = {},
): RecordEventBody => ({ type: 'workspace-step', step: name, state, attempt, ...extra })

const attemptStarted = (attempt: number): RecordEventBody => ({
  type: 'workspace-attempt-started',
  attempt,
})

const prepareFailed = (attempt: number): RecordEventBody => ({
  type: 'workspace-prepare-failed',
  reason: TIMEOUT,
  inboxHead: 1,
  attempt,
})

const at = (seconds: number): string => `2026-11-20T10:${String(seconds).padStart(2, '0')}.000Z`

const log = (bodies: RecordEventBody[], from = 0): RecordEvent[] =>
  chainEvents({
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    epoch: 1,
    at: at(from),
    bodies,
  }).map((event, index) => ({ ...event, at: at(from + index) }))

const sandboxUp = (attempt: number): RecordEventBody[] => [
  step(attempt, EWorkspaceStep.Sandbox, EWorkspaceStepState.Started),
  step(attempt, EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
  step(attempt, EWorkspaceStep.Daemon, EWorkspaceStepState.Started),
  step(attempt, EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
]

const failedAttempt = (failure: 'sandbox' | 'setup'): RecordEventBody[] => [
  attemptStarted(1),
  ...sandboxUp(1),
  ...(failure === 'sandbox'
    ? []
    : [
        step(1, EWorkspaceStep.Clone, EWorkspaceStepState.Done),
        step(1, EWorkspaceStep.Setup, EWorkspaceStepState.Started, { command: 'bun install' }),
        step(1, EWorkspaceStep.Setup, EWorkspaceStepState.Failed, {
          reason: 'setup failed: the sandbox did not answer within 60s',
          command: 'bun install',
          output: '',
        }),
      ]),
  prepareFailed(1),
]

const statusOfEvents = (events: readonly RecordEvent[]) =>
  sessionStatusOf({
    events,
    live: true,
    queuedSince: null,
    messageAfterFailure: false,
    now: at(50),
  })

const viewOf = (events: readonly RecordEvent[]) =>
  sessionBootViewOf({ events, status: statusOfEvents(events) })

const statesOf = (view: ReturnType<typeof sessionBootViewOf>) => view?.steps.map((s) => s.state)

describe('the boot card across a retry', () => {
  it('does not keep the previous attempt’s failure on a step the retry has not reached', () => {
    const events = log([
      ...failedAttempt('setup'),
      attemptStarted(2),
      ...sandboxUp(2),
      step(2, EWorkspaceStep.Clone, EWorkspaceStepState.Started, {
        repos: [{ repo: 'dltech/atlas', state: EWorkspaceRepoState.Cloning }],
      }),
    ])
    const view = viewOf(events)
    expect(statesOf(view)).toEqual([
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.error).toBeUndefined()
  })

  it('does not colour a step the retry has just started with the stale prepare failure', () => {
    const events = log([
      ...failedAttempt('sandbox'),
      attemptStarted(2),
      step(2, EWorkspaceStep.Sandbox, EWorkspaceStepState.Started),
      step(2, EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
      step(2, EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
      step(2, EWorkspaceStep.Clone, EWorkspaceStepState.Started, {
        repos: [{ repo: 'dltech/atlas', state: EWorkspaceRepoState.Cloning }],
      }),
    ])
    expect(statusOfEvents(events).state).toBe(ESessionStatus.Preparing)
    const view = viewOf(events)
    expect(statesOf(view)).toEqual([
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.steps[2]?.children).toEqual([
      { id: 'dltech/atlas', label: 'atlas', state: EBootStepState.Running },
    ])
  })

  it('does not invent a failed step while the retry is between steps', () => {
    const events = log([
      ...failedAttempt('sandbox'),
      attemptStarted(2),
      step(2, EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
      step(2, EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
      step(2, EWorkspaceStep.Clone, EWorkspaceStepState.Done),
    ])
    const view = viewOf(events)
    expect(statesOf(view)).toEqual([
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Running)
  })

  it('does not flip a live retry back to failed when the earlier attempt’s failure lands late', () => {
    const events = log([
      attemptStarted(1),
      step(1, EWorkspaceStep.Sandbox, EWorkspaceStepState.Started),
      step(1, EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
      step(1, EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
      step(1, EWorkspaceStep.Clone, EWorkspaceStepState.Done),
      step(1, EWorkspaceStep.Setup, EWorkspaceStepState.Started, { command: 'bun install' }),
    ])
    const retried = log(
      [
        attemptStarted(2),
        step(2, EWorkspaceStep.Sandbox, EWorkspaceStepState.Started),
        step(2, EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(2, EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
        step(2, EWorkspaceStep.Clone, EWorkspaceStepState.Started),
        prepareFailed(1),
      ],
      events.length,
    )
    const view = viewOf([...events, ...retried])
    expect(statesOf(view)).toEqual([
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.error).toBeUndefined()
  })
})
