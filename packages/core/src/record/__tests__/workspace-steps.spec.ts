import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import { v2EventSchema, type V2Body } from '../event'
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
import { NOW, runId, threadId } from './support'

const log = (bodies: V2Body[]) => chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const step = (
  name: EWorkspaceStep,
  state: EWorkspaceStepState,
  extra: Partial<Omit<Extract<V2Body, { type: 'workspace-step' }>, 'type' | 'step' | 'state'>> = {},
): V2Body => ({ type: 'workspace-step', step: name, state, ...extra })

describe('workspace-step event', () => {
  it('round-trips through the v2 event schema and stays out of the model view', () => {
    const events = log([
      step(EWorkspaceStep.Clone, EWorkspaceStepState.Done, {
        outcome: EWorkspaceStepOutcome.Skipped,
      }),
    ])
    expect(v2EventSchema.parse(events[0]).type).toBe('workspace-step')
    expect(isRecordOnly(events[0] as never)).toBe(true)
    expect(toLoopEvent({ event: events[0] as never })).toBeUndefined()
  })

  it('rejects an unknown step', () => {
    const [event] = log([step(EWorkspaceStep.Clone, EWorkspaceStepState.Done)])
    expect(v2EventSchema.safeParse({ ...event, step: 'nope' }).success).toBe(false)
  })

  it('does not mark the workspace prepared', () => {
    expect(isWorkspacePrepared(log([step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done)]))).toBe(
      false,
    )
  })

  it('counts no context tokens', () => {
    const events = log([step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Started)])
    expect(contextMeterOf(events).estimatedTokens).toBe(0)
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
      unconsumedInbox: false,
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
      unconsumedInbox: false,
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
    expect(events.map((event) => v2EventSchema.parse(event))).toMatchObject([
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
