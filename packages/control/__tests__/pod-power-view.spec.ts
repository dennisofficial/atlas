import { describe, expect, it } from 'bun:test'

import { EMPTY_PENDING, EPodPowerPhase, ESessionStatus } from '@dltech/atlas-core'

import type { ControlSessionRow } from '../src/session-rows'
import { type LiveView, statusOutputOf } from '../src/session-view-read'

const PARKED_AT = '2026-11-26T10:00:00.000Z'

const rowOf = (overrides: Partial<ControlSessionRow> = {}): ControlSessionRow => ({
  sessionId: 'session-1',
  userId: 'user-1',
  projectId: null,
  title: null,
  mainThreadId: 'thread-1',
  createdAt: '2026-11-21T10:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  modelRef: 'anthropic/claude-haiku-4-5',
  modelEffort: 'medium',
  modelFast: false,
  sandboxProvider: 'agent37',
  credentialSource: 'platform',
  sandboxInstanceId: null,
  sandboxStatus: null,
  sandboxStatusAt: null,
  sandboxStatusReason: null,
  spawnedBySessionId: null,
  nested: true,
  podSessionId: null,
  podDesiredVcpus: null,
  podDesiredMemoryGb: null,
  podDesiredDiskGb: null,
  podSizeGeneration: 0,
  podActualVcpus: null,
  podActualMemoryGb: null,
  podAppliedGeneration: null,
  podResizeError: null,
  podWaitingSince: null,
  podParkedAt: null,
  podParkError: null,
  routineId: null,
  ...overrides,
})

const liveOf = (over: { live?: boolean; wantsHolder?: boolean } = {}): LiveView => ({
  value: {
    status: { state: ESessionStatus.Idle },
    context: null,
    spend: [],
    checkouts: { repos: [], primary: null },
    pluginViews: {},
  },
  lease: {
    sessionId: 'session-1',
    epoch: 0,
    holderHostId: null,
    wantsHolder: over.wantsHolder === true,
    attempts: 0,
    retryAfter: null,
  },
  live: over.live === true,
  setupRunning: false,
})

const podOf = (args: { session: ControlSessionRow | undefined; live?: LiveView }) =>
  statusOutputOf({
    live: args.live ?? liveOf(),
    pending: EMPTY_PENDING,
    inbox: [],
    running: [],
    session: args.session,
  }).pod

describe('the pod power phase in the session view', () => {
  it('reports no pod before a session exists', () => {
    expect(podOf({ session: undefined })).toBeUndefined()
  })

  it('reports a steady pod for a live session with no park and no sandbox status', () => {
    expect(podOf({ session: rowOf(), live: liveOf({ live: true }) })?.power).toEqual({
      phase: EPodPowerPhase.Steady,
    })
  })

  it('reports a parked pod as stopping until its sandbox sleeps', () => {
    const parked = rowOf({
      podParkedAt: PARKED_AT,
      sandboxStatus: 'running',
      sandboxStatusAt: PARKED_AT,
    })

    expect(podOf({ session: parked, live: liveOf({ live: true }) })?.power).toEqual({
      phase: EPodPowerPhase.Stopping,
      since: PARKED_AT,
    })
  })

  it('reports a parked pod as asleep once the sandbox records its sleep', () => {
    const parked = rowOf({
      podParkedAt: PARKED_AT,
      sandboxStatus: 'sleeping',
      sandboxStatusAt: '2026-11-26T10:00:01.000Z',
    })

    expect(podOf({ session: parked })?.power).toEqual({ phase: EPodPowerPhase.Asleep })
  })

  it('keeps the resize phase beside the power phase', () => {
    const row = rowOf({ podResizeError: 'resize failed', podParkedAt: PARKED_AT })

    expect(podOf({ session: row })?.phase).toBe('failed')
    expect(podOf({ session: row })?.power).toEqual({
      phase: EPodPowerPhase.Stopping,
      since: PARKED_AT,
    })
  })

  it('reports a park failure with its error', () => {
    const parked = rowOf({ podParkedAt: PARKED_AT, podParkError: 'sleep failed' })

    expect(podOf({ session: parked })?.power).toEqual({
      phase: EPodPowerPhase.Failed,
      error: 'sleep failed',
      since: PARKED_AT,
    })
  })

  it('reports a sleeping pod that a holder wants as starting', () => {
    const row = rowOf({ sandboxStatus: 'sleeping', sandboxStatusAt: PARKED_AT })

    expect(podOf({ session: row, live: liveOf({ wantsHolder: true }) })?.power).toEqual({
      phase: EPodPowerPhase.Starting,
    })
    expect(podOf({ session: row })?.power).toEqual({ phase: EPodPowerPhase.Asleep })
  })
})
