import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EWorkspaceRepoState,
  EWorkspaceStep,
  EWorkspaceStepOutcome,
  EWorkspaceStepState,
  ESessionStatus,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import { EBootStepState } from '@dltech/atlas-wire/web'

import { sessionBootViewOf } from '../session-boot-view'

const LEASE = { epoch: 1, holderHostId: 1, live: true }

const eventsOf = (bodies: V2Body[]) =>
  chainEvents({
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    epoch: 1,
    at: '2026-11-06T10:00:00.000Z',
    bodies,
  })

const statusOf = (state: ESessionStatus, reason?: string): SessionSnapshot['status'] => ({
  state,
  lease: LEASE,
  ...(reason === undefined ? {} : { reason }),
})

const step = (
  name: EWorkspaceStep,
  state: EWorkspaceStepState,
  extra: Partial<Omit<Extract<V2Body, { type: 'workspace-step' }>, 'type' | 'step' | 'state'>> = {},
): V2Body => ({ type: 'workspace-step', step: name, state, ...extra })

const statesOf = (view: ReturnType<typeof sessionBootViewOf>) => view?.steps.map((s) => s.state)

describe('sessionBootViewOf', () => {
  it('is null with no steps once the session is past preparing', () => {
    expect(sessionBootViewOf({ events: [], status: statusOf(ESessionStatus.Idle) })).toBeNull()
    expect(sessionBootViewOf({ events: [], status: undefined })).toBeNull()
  })

  it('shows every step pending-then-running while preparing', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Started),
      ]),
      status: statusOf(ESessionStatus.Preparing),
    })
    expect(view?.steps.map((s) => s.label)).toEqual([
      'Sandbox started',
      'Starting daemon',
      'Cloning repository',
      'Running setup script',
    ])
    expect(statesOf(view)).toEqual([
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.startedAtMs).toBe(Date.parse('2026-11-06T10:00:00.000Z'))
  })

  it('settles with skipped labels after the workspace is prepared', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Done, {
          outcome: EWorkspaceStepOutcome.Skipped,
        }),
        step(EWorkspaceStep.Setup, EWorkspaceStepState.Done, {
          outcome: EWorkspaceStepOutcome.Skipped,
        }),
        { type: 'workspace-prepared' },
      ]),
      status: statusOf(ESessionStatus.Idle),
    })
    expect(view?.state).toBe(EBootStepState.Done)
    expect(view?.steps.map((s) => s.label)).toEqual([
      'Sandbox started',
      'Daemon started',
      'Repository already there',
      'No setup needed',
    ])
    expect(view?.startedAtMs).toBeUndefined()
  })

  it('shows the failed step with its reason on setup failure', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Failed, { reason: 'clone failed' }),
      ]),
      status: statusOf(ESessionStatus.SetupFailed, 'clone failed'),
    })
    expect(statesOf(view)).toEqual([
      EBootStepState.Done,
      EBootStepState.Done,
      EBootStepState.Error,
      EBootStepState.Pending,
    ])
    expect(view?.state).toBe(EBootStepState.Error)
    expect(view?.error).toBe('clone failed')
  })

  it('marks the first unfinished step failed when no step recorded the failure', () => {
    const view = sessionBootViewOf({
      events: eventsOf([step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done)]),
      status: statusOf(ESessionStatus.SetupFailed, 'boom'),
    })
    expect(view?.steps[1]?.state).toBe(EBootStepState.Error)
    expect(view?.error).toBe('boom')
  })
})

describe('sessionBootViewOf detail', () => {
  it('lists a single repo as a clone child with its state', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        step(EWorkspaceStep.Sandbox, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Daemon, EWorkspaceStepState.Done),
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Started, {
          repos: [{ repo: 'acme/app', state: EWorkspaceRepoState.Cloning }],
        }),
      ]),
      status: statusOf(ESessionStatus.Preparing),
    })
    expect(view?.steps[2]?.children).toEqual([
      { id: 'acme/app', label: 'app', state: EBootStepState.Running },
    ])
  })

  it('shows every repo with its own state', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        step(EWorkspaceStep.Clone, EWorkspaceStepState.Failed, {
          reason: 'nope',
          repos: [
            { repo: 'acme/app', state: EWorkspaceRepoState.Done },
            { repo: 'acme/lib', state: EWorkspaceRepoState.Failed },
          ],
        }),
      ]),
      status: statusOf(ESessionStatus.SetupFailed, 'nope'),
    })
    expect(view?.steps[2]?.children?.map((child) => child.state)).toEqual([
      EBootStepState.Done,
      EBootStepState.Error,
    ])
  })

  it('shows the setup command with live output while running', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        step(EWorkspaceStep.Setup, EWorkspaceStepState.Started, { command: 'bun i' }),
      ]),
      status: statusOf(ESessionStatus.Preparing),
      setupOutput: 'resolving\n',
    })
    expect(view?.steps[3]).toMatchObject({ command: 'bun i', output: 'resolving\n' })
  })

  it('shows the recorded output tail on a reopened session', () => {
    const view = sessionBootViewOf({
      events: eventsOf([
        step(EWorkspaceStep.Setup, EWorkspaceStepState.Done, { command: 'bun i', output: 'ok\n' }),
        { type: 'workspace-prepared' },
      ]),
      status: statusOf(ESessionStatus.Idle),
    })
    expect(view?.steps[3]).toMatchObject({ command: 'bun i', output: 'ok\n' })
  })
})
