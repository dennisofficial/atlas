import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import { recordEventSchema, type RecordEventBody } from '../event'
import { isRecordOnly, toLoopEvent } from '../loop-events'
import { contextMeterOf } from '../context-meter'
import { ESessionStatus, sessionStatusOf } from '../session-status'
import {
  EWorkspaceRepoState,
  EWorkspaceStep,
  EWorkspaceStepOutcome,
  EWorkspaceStepState,
  isWorkspacePrepared,
} from '../workspace'
import { workspaceStepsOf } from '../workspace-steps'
import { latestAttemptOf, nextAttemptOf } from '../workspace-attempts'
import { lastPrepareFailure } from '../workspace'
import { NOW, runId, threadId } from './support'

const log = (bodies: RecordEventBody[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const step = (
  name: EWorkspaceStep,
  state: EWorkspaceStepState,
  extra: Partial<
    Omit<Extract<RecordEventBody, { type: 'workspace-step' }>, 'type' | 'step' | 'state'>
  > = {},
): RecordEventBody => ({ type: 'workspace-step', step: name, state, ...extra })

describe('workspace-step event', () => {
  it('round-trips through the v2 event schema and stays out of the model view', () => {
    const events = log([
      step(EWorkspaceStep.Clone, EWorkspaceStepState.Done, {
        outcome: EWorkspaceStepOutcome.Skipped,
      }),
    ])
    expect(recordEventSchema.parse(events[0]).type).toBe('workspace-step')
    expect(isRecordOnly(events[0] as never)).toBe(true)
    expect(toLoopEvent({ event: events[0] as never })).toBeUndefined()
  })

  it('rejects an unknown step', () => {
    const [event] = log([step(EWorkspaceStep.Clone, EWorkspaceStepState.Done)])
    expect(recordEventSchema.safeParse({ ...event, step: 'nope' }).success).toBe(false)
  })

  it('does not mark the workspace prepared', () => {
    expect(isWorkspacePrepared(log([step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done)]))).toBe(
      false,
    )
  })

  it('counts no context tokens', () => {
    const events = log([step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Started)])
    expect(contextMeterOf(events).used).toBeNull()
  })
})

describe('workspaceStepsOf', () => {
  it('keeps the latest state per step', () => {
    const folded = workspaceStepsOf(
      log([
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Started),
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Started),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Failed, { reason: 'clone failed' }),
      ]),
    )
    expect(folded.sandbox?.state).toBe(EWorkspaceStepState.Done)
    expect(folded.daemon?.state).toBe(EWorkspaceStepState.Started)
    expect(folded.clone).toMatchObject({
      state: EWorkspaceStepState.Failed,
      reason: 'clone failed',
    })
    expect(folded.setup).toBeUndefined()
  })
})

describe('status while steps are recorded', () => {
  it('stays preparing', () => {
    const status = sessionStatusOf({
      events: log([step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done)]),
      live: true,
      queuedSince: null,
      messageAfterFailure: false,
      now: NOW,
    })
    expect(status.state).toBe(ESessionStatus.Preparing)
  })

  it('is idle once prepared after the steps', () => {
    const status = sessionStatusOf({
      events: log([
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        { type: 'workspace-prepared' },
      ]),
      live: true,
      queuedSince: null,
      messageAfterFailure: false,
      now: NOW,
    })
    expect(status.state).toBe(ESessionStatus.Idle)
  })
})

describe('workspace-step detail', () => {
  it('round-trips repos, command and output through the schema', () => {
    const events = log([
      step(EWorkspaceStep.Clone, EWorkspaceStepState.Started, {
        repos: [{ repo: 'acme/app', state: EWorkspaceRepoState.Pending }],
      }),
      step(EWorkspaceStep.Setup, EWorkspaceStepState.Done, { command: 'bun i', output: 'ok' }),
    ])
    expect(events.map((event) => recordEventSchema.parse(event))).toMatchObject([
      { repos: [{ repo: 'acme/app', state: 'pending' }] },
      { command: 'bun i', output: 'ok' },
    ])
  })

  it('folds the latest repo list and keeps the setup command from the started event', () => {
    const folded = workspaceStepsOf(
      log([
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Started, {
          repos: [{ repo: 'acme/app', state: EWorkspaceRepoState.Cloning }],
        }),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Done, {
          repos: [{ repo: 'acme/app', state: EWorkspaceRepoState.Done }],
        }),
        step(EWorkspaceStep.Setup, EWorkspaceStepState.Started, { command: 'bun i' }),
        step(EWorkspaceStep.Setup, EWorkspaceStepState.Failed, { reason: 'x', output: 'bad' }),
      ]),
    )
    expect(folded.clone?.repos).toEqual([{ repo: 'acme/app', state: EWorkspaceRepoState.Done }])
    expect(folded.setup).toMatchObject({ command: 'bun i', output: 'bad' })
  })
})

const attemptStarted = (attempt: number): RecordEventBody => ({
  type: 'workspace-attempt-started',
  attempt,
})

const FAILED = 'sandbox did not answer'

const failedFirstAttempt = (): RecordEventBody[] => [
  attemptStarted(1),
  step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Started, { attempt: 1 }),
  step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done, { attempt: 1 }),
  step(EWorkspaceStep.Setup, EWorkspaceStepState.Started, { attempt: 1, command: 'bun i' }),
  step(EWorkspaceStep.Setup, EWorkspaceStepState.Failed, {
    attempt: 1,
    reason: FAILED,
    command: 'bun i',
  }),
  { type: 'workspace-prepare-failed', reason: FAILED, inboxHead: 1, attempt: 1 },
]

describe('workspace attempts', () => {
  it('round-trips an attempt through the v2 event schema', () => {
    const [event] = log([attemptStarted(2)])
    expect(recordEventSchema.parse(event)).toMatchObject({
      type: 'workspace-attempt-started',
      attempt: 2,
    })
    expect(recordEventSchema.safeParse({ ...event, attempt: 0 }).success).toBe(false)
  })

  it('numbers the next attempt from the log', () => {
    expect(nextAttemptOf(log(failedFirstAttempt()))).toBe(2)
    expect(nextAttemptOf(log([]))).toBe(1)
    expect(latestAttemptOf(log(failedFirstAttempt()))).toBe(1)
  })

  it('folds only the steps of the latest attempt', () => {
    const folded = workspaceStepsOf(
      log([
        ...failedFirstAttempt(),
        attemptStarted(2),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Started, {
          attempt: 2,
          repos: [{ repo: 'acme/app', state: EWorkspaceRepoState.Cloning }],
        }),
      ]),
    )
    expect(folded.sandbox).toBeUndefined()
    expect(folded.setup).toBeUndefined()
    expect(folded.clone).toMatchObject({
      state: EWorkspaceStepState.Started,
      repos: [{ repo: 'acme/app', state: EWorkspaceRepoState.Cloning }],
    })
  })

  it('folds an untagged log with the attempt in force at its position', () => {
    const folded = workspaceStepsOf(
      log([
        attemptStarted(1),
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        attemptStarted(2),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
      ]),
    )
    expect(folded.sandbox).toBeUndefined()
    expect(folded.daemon?.state).toBe(EWorkspaceStepState.Done)
  })

  it('keeps folding a log that never recorded an attempt', () => {
    const folded = workspaceStepsOf(
      log([
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Started),
      ]),
    )
    expect(folded.sandbox?.state).toBe(EWorkspaceStepState.Done)
    expect(folded.daemon?.state).toBe(EWorkspaceStepState.Started)
  })

  it('clears the prepare failure when a new attempt starts', () => {
    const status = sessionStatusOf({
      events: log([...failedFirstAttempt(), attemptStarted(2)]),
      live: true,
      queuedSince: null,
      messageAfterFailure: false,
      now: NOW,
    })
    expect(status.state).toBe(ESessionStatus.Preparing)
  })

  it('ignores a failure the superseded attempt reports late', () => {
    const events = log([
      ...failedFirstAttempt(),
      attemptStarted(2),
      { type: 'workspace-prepare-failed', reason: 'late', inboxHead: 2, attempt: 1 },
    ])
    const status = sessionStatusOf({
      events,
      live: true,
      queuedSince: null,
      messageAfterFailure: false,
      now: NOW,
    })
    expect(status.state).toBe(ESessionStatus.Preparing)
    expect(lastPrepareFailure(events)).toBeUndefined()
  })

  it('reports the failure of the latest attempt', () => {
    const events = log([
      ...failedFirstAttempt(),
      attemptStarted(2),
      { type: 'workspace-prepare-failed', reason: 'again', inboxHead: 2, attempt: 2 },
    ])
    expect(lastPrepareFailure(events)).toMatchObject({ reason: 'again', inboxHead: 2 })
  })
})
