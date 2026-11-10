import { beforeEach, describe, expect, it } from 'bun:test'
import { chainEvents, toRunId, toThreadId, type V2Body, type V2Event } from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import type { RoutineRow } from '../src/port'
import { InMemoryControlStore } from '../src/testing/memory'

const T0 = '2026-11-02T12:00:00.000Z'
const MINUTE = 60_000
const WEDGED_AFTER = 5 * MINUTE

const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * MINUTE).toISOString()

const routineOf = (params: {
  routineId?: string
  nextRunAt: string
  enabled?: boolean
  lastSessionId?: string | null
}): RoutineRow => ({
  routineId: params.routineId ?? 'routine-1',
  userId: 'user-1',
  projectId: 'project-1',
  name: 'Inbox digest',
  prompt: 'Summarise what happened overnight',
  cron: '0 * * * *',
  timezone: 'UTC',
  enabled: params.enabled ?? true,
  modelRef: 'claude-sonnet-4-6',
  modelEffort: 'high',
  modelFast: false,
  nextRunAt: params.nextRunAt,
  lastRunAt: null,
  lastSessionId: params.lastSessionId ?? null,
  createdAt: T0,
  updatedAt: T0,
})

let store: InMemoryControlStore
let plane: ControlPlane
let minted: number

beforeEach(() => {
  store = new InMemoryControlStore({ clock: () => T0 })
  plane = new ControlPlane({ store, clock: () => T0 })
  minted = 0
})

const seed = (row: RoutineRow): RoutineRow => {
  store.setRoutine(row)
  return row
}

const nextHour = (args: { after: string }): string =>
  new Date(Date.parse(args.after) + 60 * MINUTE).toISOString()

const run = (params: { scheduledFor: string; now: string; routineId?: string }) =>
  plane.runRoutine({
    routineId: params.routineId ?? 'routine-1',
    scheduledFor: params.scheduledFor,
    now: params.now,
    wedgedAfterMs: WEDGED_AFTER,
    nextOccurrence: nextHour,
    createSessionId: () => {
      minted += 1
      return { sessionId: `session-${minted}`, mainThreadId: `thread-${minted}` }
    },
  })

const routineNow = async (routineId = 'routine-1'): Promise<RoutineRow | undefined> =>
  store.transact((tx) => tx.readRoutine(routineId))

describe('ControlPlane.runRoutine', () => {
  it('creates the session, posts the prompt, ledgers the run and advances the routine', async () => {
    seed(routineOf({ nextRunAt: at(0) }))
    const result = await run({ scheduledFor: at(0), now: at(0) })
    expect(result).toEqual({ outcome: 'started', sessionId: 'session-1' })

    const session = await plane.readSession({ sessionId: 'session-1' })
    expect(session).toMatchObject({
      userId: 'user-1',
      projectId: 'project-1',
      title: 'Inbox digest',
      modelRef: 'claude-sonnet-4-6',
      modelEffort: 'high',
      modelFast: false,
    })
    const inbox = await plane.readInbox({ sessionId: 'session-1', afterId: 0, limit: 10 })
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.kind).toBe('message')
    expect(JSON.parse(inbox[0]?.payload ?? '{}')).toEqual({
      text: 'Summarise what happened overnight',
    })

    expect(await routineNow()).toMatchObject({
      nextRunAt: at(60),
      lastRunAt: at(0),
      lastSessionId: 'session-1',
    })
    expect(store.routineRuns('routine-1')).toMatchObject([
      { outcome: 'started', sessionId: 'session-1', scheduledFor: at(0) },
    ])
  })

  it('ledgers a disabled routine without running it or moving the schedule', async () => {
    seed(routineOf({ nextRunAt: at(0), enabled: false }))
    const result = await run({ scheduledFor: at(0), now: at(0) })
    expect(result).toEqual({ outcome: 'skipped', reason: 'disabled' })
    expect(await plane.readSession({ sessionId: 'session-1' })).toBeUndefined()
    expect(await routineNow()).toMatchObject({ nextRunAt: at(0), lastRunAt: null })
    expect(store.routineRuns('routine-1')).toMatchObject([
      { outcome: 'skipped', reason: 'disabled' },
    ])
  })

  it('refuses to run an occurrence an earlier dispatch already handled', async () => {
    seed(routineOf({ nextRunAt: at(60) }))
    const result = await run({ scheduledFor: at(0), now: at(0) })
    expect(result).toEqual({ outcome: 'skipped', reason: 'already-ran' })
    expect(await plane.readSession({ sessionId: 'session-1' })).toBeUndefined()
    expect(await routineNow()).toMatchObject({ nextRunAt: at(60), lastRunAt: null })
    expect(store.routineRuns('routine-1')).toMatchObject([
      { outcome: 'skipped', reason: 'already-ran' },
    ])
  })

  it('reports a missing routine and writes no ledger row', async () => {
    expect(await run({ scheduledFor: at(0), now: at(0) })).toEqual({
      outcome: 'skipped',
      reason: 'routine-not-found',
    })
    expect(store.routineRuns('routine-1')).toEqual([])
  })

  it('skips a busy routine, keeping its cadence, when the last session is unfinished', async () => {
    seed(routineOf({ nextRunAt: at(0) }))
    await run({ scheduledFor: at(0), now: at(0) })
    const busy = await run({ scheduledFor: at(60), now: at(60) })
    expect(busy).toEqual({ outcome: 'skipped-busy', reason: 'preparing' })
    expect(minted).toBe(1)
    expect(await routineNow()).toMatchObject({ nextRunAt: at(120), lastSessionId: 'session-1' })
    expect(store.routineRuns('routine-1').map((row) => row.outcome)).toEqual([
      'started',
      'skipped-busy',
    ])
  })

  it('runs again when the last session looks busy but its lease is gone and it is wedged', async () => {
    const parked = seed(routineOf({ nextRunAt: at(0), lastSessionId: 'parked' }))
    expect(parked.lastSessionId).toBe('parked')
    await plane.createSession({
      sessionId: 'parked',
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: 'parked-thread',
    })
    const hostId = store.nextHostId()
    const lease = await plane.grant({ sessionId: 'parked', hostId })
    const head = await plane.head({ threadId: 'parked-thread' })
    const body: V2Body = { type: 'user-said', text: 'keep going' }
    const events: V2Event[] = chainEvents({
      threadId: toThreadId('parked-thread'),
      runId: toRunId('run-1'),
      epoch: lease.epoch,
      at: at(-30),
      bodies: [body],
      from: head,
    })
    const appended = await plane.append({
      threadId: 'parked-thread',
      epoch: lease.epoch,
      events,
    })
    expect(appended.ok).toBe(true)

    const result = await run({ scheduledFor: at(0), now: at(0) })
    expect(result).toEqual({ outcome: 'started', sessionId: 'session-1' })
    expect(store.routineRuns('routine-1').map((row) => row.outcome)).toEqual(['started'])
  })

  it('spawns exactly one session when the same occurrence is dispatched twice', async () => {
    seed(routineOf({ nextRunAt: at(0) }))
    const [first, second] = await Promise.all([
      run({ scheduledFor: at(0), now: at(0) }),
      run({ scheduledFor: at(0), now: at(0) }),
    ])
    const outcomes = [first.outcome, second.outcome].sort()
    expect(outcomes).toEqual(['skipped', 'started'])
    expect(minted).toBe(1)
    expect(store.routineRuns('routine-1').filter((row) => row.outcome === 'started')).toHaveLength(
      1,
    )
  })
})
