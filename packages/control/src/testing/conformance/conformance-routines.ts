import { beforeEach, describe, expect, it } from 'bun:test'

import type { ControlStorePort, RoutineRow } from '../../port'
import type { ConformanceParams } from './conformance'
import { describeControlPlaneRoutineCrud } from './conformance-routine-crud'
import { makeHarness } from './support'

export type RoutinesConformanceParams = ConformanceParams & {
  seedRoutine: (row: RoutineRow) => Promise<void>
}

const T0 = '2026-11-02T12:00:00.000Z'
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString()

const routineOf = (params: {
  routineId: string
  nextRunAt: string
  enabled?: boolean
  lastSessionId?: string | null
}): RoutineRow => ({
  routineId: params.routineId,
  userId: 'user-1',
  projectId: 'project-1',
  name: params.routineId,
  prompt: 'summarise the inbox',
  cron: '0 * * * *',
  timezone: 'UTC',
  enabled: params.enabled ?? true,
  modelRef: null,
  modelEffort: null,
  modelFast: null,
  nextRunAt: params.nextRunAt,
  lastRunAt: null,
  lastSessionId: params.lastSessionId ?? null,
  createdAt: T0,
  updatedAt: T0,
})

export function describeControlPlaneRoutines(params: RoutinesConformanceParams): void {
  describe(`ControlPlane routines (${params.name})`, () => {
    let store: ControlStorePort

    beforeEach(async () => {
      await params.reset()
      store = params.makeStore()
    })

    const seed = async (row: RoutineRow): Promise<void> => params.seedRoutine(row)

    const dueIds = async (now: string, limit = 100): Promise<string[]> =>
      (await store.listDueRoutines({ now, limit })).map((row) => row.routineId)

    it('lists only enabled routines whose nextRunAt has come, in occurrence order', async () => {
      await seed(routineOf({ routineId: 'later', nextRunAt: at(30) }))
      await seed(routineOf({ routineId: 'paused', nextRunAt: at(-30), enabled: false }))
      await seed(routineOf({ routineId: 'first', nextRunAt: at(-60) }))
      await seed(routineOf({ routineId: 'future', nextRunAt: at(120) }))
      await seed(routineOf({ routineId: 'second', nextRunAt: at(-10) }))
      expect(await dueIds(at(0))).toEqual(['first', 'second'])
      expect(await dueIds(at(45))).toEqual(['first', 'second', 'later'])
      expect(await dueIds(at(-120))).toEqual([])
    })

    it('bounds the due listing by the limit in occurrence order', async () => {
      await seed(routineOf({ routineId: 'third', nextRunAt: at(-1) }))
      await seed(routineOf({ routineId: 'first', nextRunAt: at(-30) }))
      await seed(routineOf({ routineId: 'second', nextRunAt: at(-20) }))
      expect(await dueIds(at(0), 2)).toEqual(['first', 'second'])
      expect(await dueIds(at(0), 1)).toEqual(['first'])
      expect(await dueIds(at(0), 0)).toEqual([])
    })

    it('advances only while the row still holds the expected occurrence', async () => {
      await seed(routineOf({ routineId: 'cas', nextRunAt: at(0) }))
      const moved = await store.transact((tx) =>
        tx.advanceRoutine({
          routineId: 'cas',
          expectedNextRunAt: at(0),
          nextRunAt: at(60),
          lastRunAt: at(0),
          at: at(0),
        }),
      )
      expect(moved).toBe(true)
      const stale = await store.transact((tx) =>
        tx.advanceRoutine({
          routineId: 'cas',
          expectedNextRunAt: at(0),
          nextRunAt: at(120),
          at: at(0),
        }),
      )
      expect(stale).toBe(false)
      const row = await store.transact((tx) => tx.readRoutine('cas'))
      expect(row).toMatchObject({ nextRunAt: at(60), lastRunAt: at(0) })
      const missing = await store.transact((tx) =>
        tx.advanceRoutine({
          routineId: 'absent',
          expectedNextRunAt: at(0),
          nextRunAt: at(60),
          at: at(0),
        }),
      )
      expect(missing).toBe(false)
    })

    it('serialises two concurrent runs that lock, read and advance the same routine', async () => {
      await seed(routineOf({ routineId: 'locked', nextRunAt: at(0) }))
      const runOnce = async (): Promise<boolean> =>
        store.transact(async (tx) => {
          const row = await tx.lockRoutine('locked')
          if (row === undefined) return false
          const next = new Date(Date.parse(row.nextRunAt) + 60_000).toISOString()
          return tx.advanceRoutine({
            routineId: 'locked',
            expectedNextRunAt: row.nextRunAt,
            nextRunAt: next,
            at: at(0),
          })
        })
      const outcomes = await Promise.all([runOnce(), runOnce()])
      expect(outcomes).toEqual([true, true])
      const row = await store.transact((tx) => tx.readRoutine('locked'))
      expect(row?.nextRunAt).toBe(at(2))
    })

    it('records the routine on the session a run starts and nothing on a composed one', async () => {
      const harness = makeHarness(params.makeStore())
      await harness.plane.createRoutine({
        ...routineOf({ routineId: 'digest', nextRunAt: at(0) }),
        name: 'Digest',
      })
      const result = await harness.plane.runRoutine({
        routineId: 'digest',
        scheduledFor: at(0),
        now: T0,
        wedgedAfterMs: 5 * 60_000,
        nextOccurrence: () => at(60),
        createSessionId: () => ({ sessionId: 'routine-session', mainThreadId: 'routine-thread' }),
      })
      expect(result.outcome).toBe('started')
      expect((await harness.plane.readSession({ sessionId: 'routine-session' }))?.routineId).toBe(
        'digest',
      )
      await harness.plane.createSession({
        sessionId: 'composed',
        userId: 'user-1',
        projectId: 'project-1',
        mainThreadId: 'composed-thread',
      })
      expect((await harness.plane.readSession({ sessionId: 'composed' }))?.routineId).toBeNull()
    })
  })

  describeControlPlaneRoutineCrud(params)
}
