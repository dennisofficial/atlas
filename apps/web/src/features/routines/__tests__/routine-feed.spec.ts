import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import type { Routine, SessionSummary } from '@dltech/atlas-protocol'

import { routineFeedInvalidationsOf, routineRunsOf } from '../routine-feed'

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

const session = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: 'ses-2',
  projectId: 'p1',
  title: null,
  naming: false,
  mainThreadId: 'thr-2',
  createdAt: '2026-11-10T07:00:00Z',
  updatedAt: '2026-11-10T07:00:00Z',
  archivedAt: null,
  routineId: 'rte-1',
  status: { state: ESessionStatus.Thinking },
  ...overrides,
})

describe('routineRunsOf', () => {
  it('keeps only the sessions a routine dispatched', () => {
    expect(
      routineRunsOf([
        session(),
        session({ sessionId: 'ses-3', routineId: null }),
        session({ sessionId: 'ses-4', routineId: undefined }),
      ]),
    ).toEqual([{ routineId: 'rte-1', sessionId: 'ses-2', state: ESessionStatus.Thinking }])
  })

  it('carries a session that has not reported a status yet', () => {
    expect(routineRunsOf([session({ status: undefined })])[0]?.state).toBeUndefined()
  })
})

describe('routineFeedInvalidationsOf', () => {
  it('invalidates the routine whose fresh run the loaded list does not claim', () => {
    expect(
      routineFeedInvalidationsOf({
        seen: [],
        runs: routineRunsOf([session()]),
        routines: [routine()],
      }),
    ).toEqual(['rte-1'])
  })

  it('stays quiet for a session that is no routine run', () => {
    const unrelated = session({ sessionId: 'ses-9', routineId: null })
    expect(
      routineFeedInvalidationsOf({
        seen: [],
        runs: routineRunsOf([unrelated]),
        routines: [routine()],
      }),
    ).toEqual([])
  })

  it('stays quiet when the routine already claims the run', () => {
    const runs = routineRunsOf([session({ sessionId: 'ses-1' })])
    expect(routineFeedInvalidationsOf({ seen: [], runs, routines: [routine()] })).toEqual([])
  })

  it('invalidates once while the same feed keeps arriving', () => {
    const runs = routineRunsOf([session()])
    expect(routineFeedInvalidationsOf({ seen: [], runs, routines: [routine()] })).toEqual(['rte-1'])
    expect(routineFeedInvalidationsOf({ seen: runs, runs, routines: [routine()] })).toEqual([])
  })

  it('invalidates again when the run settles, because the ledger is then final', () => {
    const running = routineRunsOf([session()])
    const settled = routineRunsOf([session({ status: { state: ESessionStatus.Idle } })])
    expect(
      routineFeedInvalidationsOf({ seen: running, runs: settled, routines: [routine()] }),
    ).toEqual(['rte-1'])
    expect(
      routineFeedInvalidationsOf({ seen: settled, runs: settled, routines: [routine()] }),
    ).toEqual([])
  })

  it('names a routine once even when two of its runs changed together', () => {
    const runs = routineRunsOf([session(), session({ sessionId: 'ses-5' })])
    expect(routineFeedInvalidationsOf({ seen: [], runs, routines: [routine()] })).toEqual(['rte-1'])
  })
})
