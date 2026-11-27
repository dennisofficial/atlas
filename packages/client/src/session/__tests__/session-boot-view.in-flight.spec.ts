import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  ESessionStatus,
  EWorkspaceStep,
  EWorkspaceStepState,
  toRunId,
  toThreadId,
  type RecordEventBody,
  EBootStepState,
} from '@dltech/atlas-core'
import type { SessionSnapshot } from '../../stream'

import { bootViewAt, sessionBootViewOf } from '../session-boot-view'

const eventsOf = (bodies: RecordEventBody[]) =>
  chainEvents({
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    epoch: 1,
    at: '2026-11-26T16:11:03.000Z',
    bodies,
  })

const statusOf = (state: ESessionStatus): SessionSnapshot['status'] => ({
  state,
  lease: { epoch: 1, holderHostId: 1, live: true },
})

const step = (name: EWorkspaceStep, state: EWorkspaceStepState): RecordEventBody => ({
  type: 'workspace-step',
  step: name,
  state,
})

const ATTEMPT: RecordEventBody = { type: 'workspace-attempt-started', attempt: 1 }

const statesOf = (view: ReturnType<typeof sessionBootViewOf>) => view?.steps.map((s) => s.state)

describe('sessionBootViewOf while the record shows the boot in flight', () => {
  it('shows a starting sandbox as running even when the status is not preparing', () => {
    const view = sessionBootViewOf({
      events: eventsOf([ATTEMPT, step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Started)]),
      status: statusOf(ESessionStatus.Queued),
    })
    expect(statesOf(view)).toEqual([
      EBootStepState.Running,
      EBootStepState.Pending,
      EBootStepState.Pending,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.error).toBeUndefined()
  })

  it('shows a running clone as running, with later steps pending, under any status', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        ATTEMPT,
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Started),
      ]),
      status: statusOf(ESessionStatus.Idle),
    })
    expect(statesOf(view)).toEqual([
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Running)
  })

  it('still reads a step left started as failed once the session failed to start', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        ATTEMPT,
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Started),
        { type: 'session-start-failed', reason: 'no capacity', inboxHead: 1, permanent: false },
      ]),
      status: statusOf(ESessionStatus.StartFailed),
    })
    expect(view?.steps[0]?.state).toBe(EBootStepState.Error)
    expect(view?.state).toBe(EBootStepState.Error)
  })

  it('still reads a non-setup step left started as failed after the workspace was prepared', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        ATTEMPT,
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Started),
        { type: 'workspace-prepared' },
      ]),
      status: statusOf(ESessionStatus.Idle),
    })
    expect(view?.steps[2]?.state).toBe(EBootStepState.Error)
  })
})

describe('bootViewAt', () => {
  it('ticks a running start to now and leaves a settled one alone', () => {
    const running = { steps: [], state: EBootStepState.Running, startedAtMs: 1_000 }
    expect(bootViewAt({ view: running, now: 3_500 }).elapsedMs).toBe(2_500)
    const settled = { steps: [], state: EBootStepState.Done, elapsedMs: 4_200 }
    expect(bootViewAt({ view: settled, now: 9_999 })).toBe(settled)
  })
})
