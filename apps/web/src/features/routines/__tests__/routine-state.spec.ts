import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import type { Routine, SessionSummary } from '@dltech/atlas-protocol'

import { metaLineOf } from '../routine-meta'
import {
  ERoutineState,
  isRoutineSessionLive,
  pushedSessionStateOf,
  routineStateOf,
} from '../routine-state'

const NOW = Date.parse('2026-11-10T07:04:00Z')

const routine = (overrides: Partial<Routine> = {}): Routine => ({
  routineId: 'rte-1',
  projectId: 'p1',
  name: 'Dead code sweep',
  prompt: 'Sweep the workspace.',
  cron: '0 7 * * 1-5',
  timezone: 'Europe/London',
  enabled: true,
  model: null,
  effort: null,
  fast: null,
  nextRunAt: '2026-11-11T07:00:00Z',
  lastRunAt: '2026-11-10T07:00:00Z',
  lastSessionId: 'ses-1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...overrides,
})

describe('routineStateOf', () => {
  it('is off whenever the routine is paused, whatever its last session is doing', () => {
    expect(
      routineStateOf({
        routine: routine({ enabled: false }),
        sessionState: ESessionStatus.Thinking,
      }),
    ).toBe(ERoutineState.Off)
  })

  it('is working only while its last session is still running', () => {
    expect(routineStateOf({ routine: routine(), sessionState: ESessionStatus.Thinking })).toBe(
      ERoutineState.Working,
    )
    expect(routineStateOf({ routine: routine(), sessionState: ESessionStatus.Idle })).toBe(
      ERoutineState.Idle,
    )
  })

  it('is working while the dispatcher waits on credentials', () => {
    expect(
      routineStateOf({
        routine: routine(),
        sessionState: ESessionStatus.WaitingForCredentials,
      }),
    ).toBe(ERoutineState.Working)
  })

  it('is skipped when the last run started no session', () => {
    expect(
      routineStateOf({ routine: routine({ lastSessionId: null }), sessionState: undefined }),
    ).toBe(ERoutineState.Skipped)
  })

  it('is idle before the first run', () => {
    expect(
      routineStateOf({
        routine: routine({ lastRunAt: null, lastSessionId: null }),
        sessionState: undefined,
      }),
    ).toBe(ERoutineState.Idle)
  })
})

describe('pushedSessionStateOf', () => {
  const sessions: readonly SessionSummary[] = [
    {
      sessionId: 'ses-1',
      projectId: 'p1',
      title: null,
      naming: false,
      mainThreadId: 'thr-1',
      createdAt: '2026-11-10T07:00:00Z',
      updatedAt: '2026-11-10T07:00:00Z',
      archivedAt: null,
      routineId: 'rte-1',
      status: { state: ESessionStatus.Thinking },
    },
  ]

  it('reads the pushed row of the routine last session', () => {
    expect(pushedSessionStateOf({ sessionId: 'ses-1', sessions })).toBe(ESessionStatus.Thinking)
  })

  it('has no state for a routine that started no session, or whose row is not pushed', () => {
    expect(pushedSessionStateOf({ sessionId: null, sessions })).toBeUndefined()
    expect(pushedSessionStateOf({ sessionId: 'ses-404', sessions })).toBeUndefined()
  })
})

describe('isRoutineSessionLive', () => {
  it('counts every status the agent is still working through', () => {
    expect(isRoutineSessionLive(ESessionStatus.RunningTool)).toBe(true)
    expect(isRoutineSessionLive(ESessionStatus.Idle)).toBe(false)
    expect(isRoutineSessionLive(ESessionStatus.Failed)).toBe(false)
    expect(isRoutineSessionLive(undefined)).toBe(false)
  })

  it('counts a credentials wait and every other unsettled status as live', () => {
    const settled: readonly ESessionStatus[] = [
      ESessionStatus.Idle,
      ESessionStatus.Failed,
      ESessionStatus.StartFailed,
      ESessionStatus.SetupFailed,
    ]
    const unsettled = Object.values(ESessionStatus).filter((state) => !settled.includes(state))
    expect(unsettled).toContain(ESessionStatus.WaitingForCredentials)
    for (const state of unsettled) expect(isRoutineSessionLive(state)).toBe(true)
  })
})

describe('metaLineOf', () => {
  it('says since when a run has been working', () => {
    expect(
      metaLineOf({ routine: routine(), state: ERoutineState.Working, now: NOW, timeZone: 'UTC' }),
    ).toBe('Running since 07:00')
  })

  it('names the paused and skipped states', () => {
    expect(
      metaLineOf({ routine: routine(), state: ERoutineState.Off, now: NOW, timeZone: 'UTC' }),
    ).toBe('Every weekday at 07:00 · paused')
    expect(
      metaLineOf({ routine: routine(), state: ERoutineState.Skipped, now: NOW, timeZone: 'UTC' }),
    ).toBe('Every weekday at 07:00 · last run skipped')
  })

  it('counts down to the next run when idle', () => {
    expect(
      metaLineOf({ routine: routine(), state: ERoutineState.Idle, now: NOW, timeZone: 'UTC' }),
    ).toBe('Every weekday at 07:00 · next in 24h')
  })
})
