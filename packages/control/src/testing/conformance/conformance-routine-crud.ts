import { beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '../../control-plane'
import type { ControlStorePort, RoutineRow, RoutineRunOutcome } from '../../port'
import type { RoutinesConformanceParams } from './conformance-routines'

const T0 = '2026-11-02T12:00:00.000Z'
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString()

const routineParams = (params: {
  routineId: string
  at?: string
  name?: string
  userId?: string
  projectId?: string
  nextRunAt?: string
  enabled?: boolean
}): RoutineRow => ({
  routineId: params.routineId,
  userId: params.userId ?? 'user-1',
  projectId: params.projectId ?? 'project-1',
  name: params.name ?? params.routineId,
  prompt: `run ${params.routineId}`,
  cron: '0 * * * *',
  timezone: 'UTC',
  enabled: params.enabled ?? true,
  modelRef: null,
  modelEffort: null,
  modelFast: null,
  nextRunAt: params.nextRunAt ?? at(60),
  lastRunAt: null,
  lastSessionId: null,
  createdAt: params.at ?? T0,
  updatedAt: params.at ?? T0,
})

export function describeControlPlaneRoutineCrud(params: RoutinesConformanceParams): void {
  describe(`ControlPlane routine CRUD (${params.name})`, () => {
    let plane: ControlPlane
    let store: ControlStorePort

    beforeEach(async () => {
      await params.reset()
      store = params.makeStore()
      plane = new ControlPlane({ store, clock: () => T0 })
    })

    it('creates a routine and reads it back for its owner only', async () => {
      const created = await plane.createRoutine(routineParams({ routineId: 'digest' }))
      expect(created).toEqual({
        routineId: 'digest',
        userId: 'user-1',
        projectId: 'project-1',
        name: 'digest',
        prompt: 'run digest',
        cron: '0 * * * *',
        timezone: 'UTC',
        enabled: true,
        modelRef: null,
        modelEffort: null,
        modelFast: null,
        nextRunAt: at(60),
        lastRunAt: null,
        lastSessionId: null,
        createdAt: T0,
        updatedAt: T0,
      })
      expect(await plane.readRoutine({ routineId: 'digest', userId: 'user-1' })).toEqual(created)
      expect(await plane.readRoutine({ routineId: 'digest', userId: 'user-2' })).toBeUndefined()
      expect(await plane.readRoutine({ routineId: 'absent', userId: 'user-1' })).toBeUndefined()
    })

    it('lists one user routines in creation order, ties by name, bounded by project', async () => {
      await plane.createRoutine(routineParams({ routineId: 'zeta', name: 'zeta', at: T0 }))
      await plane.createRoutine(routineParams({ routineId: 'later', name: 'beta', at: at(5) }))
      await plane.createRoutine(routineParams({ routineId: 'alpha', name: 'alpha', at: T0 }))
      await plane.createRoutine(routineParams({ routineId: 'foreign', userId: 'user-2' }))
      await plane.createRoutine(
        routineParams({ routineId: 'elsewhere', projectId: 'project-2', at: at(10) }),
      )
      const ids = async (list: { userId: string; projectId?: string }): Promise<string[]> =>
        (await plane.listRoutines(list)).map((row) => row.routineId)
      expect(await ids({ userId: 'user-1' })).toEqual(['alpha', 'zeta', 'later', 'elsewhere'])
      expect(await ids({ userId: 'user-1', projectId: 'project-2' })).toEqual(['elsewhere'])
      expect(await ids({ userId: 'user-2' })).toEqual(['foreign'])
      expect(await ids({ userId: 'user-1', projectId: 'absent' })).toEqual([])
    })

    it('patches a routine for its owner and refuses another user', async () => {
      await plane.createRoutine(routineParams({ routineId: 'digest', name: 'Digest' }))
      const updated = await plane.updateRoutine({
        routineId: 'digest',
        userId: 'user-1',
        patch: {
          name: 'Digest v2',
          prompt: 'new prompt',
          enabled: false,
          modelRef: 'claude-sonnet-4-6',
        },
        nextRunAt: at(120),
        at: at(5),
      })
      expect(updated).toMatchObject({
        name: 'Digest v2',
        prompt: 'new prompt',
        enabled: false,
        modelRef: 'claude-sonnet-4-6',
        cron: '0 * * * *',
        nextRunAt: at(120),
        createdAt: T0,
        updatedAt: at(5),
      })
      expect(await plane.readRoutine({ routineId: 'digest', userId: 'user-1' })).toEqual(updated)

      const kept = await plane.updateRoutine({
        routineId: 'digest',
        userId: 'user-1',
        patch: { enabled: true },
        at: at(7),
      })
      expect(kept).toMatchObject({ nextRunAt: at(120), updatedAt: at(7) })

      const refused = await plane.updateRoutine({
        routineId: 'digest',
        userId: 'user-2',
        patch: { name: 'hijacked' },
        at: at(8),
      })
      expect(refused).toBeUndefined()
      expect((await plane.readRoutine({ routineId: 'digest', userId: 'user-1' }))?.name).toBe(
        'Digest v2',
      )
      expect(
        await plane.updateRoutine({ routineId: 'absent', userId: 'user-1', patch: {}, at: at(8) }),
      ).toBeUndefined()
    })

    it('deletes a routine and its ledger rows but leaves the session alone', async () => {
      await plane.createRoutine(routineParams({ routineId: 'digest' }))
      await store.transact((tx) =>
        tx.createSession({
          sessionId: 'session-1',
          userId: 'user-1',
          projectId: 'project-1',
          mainThreadId: 'thread-1',
          routineId: 'digest',
          at: T0,
        }),
      )
      await store.transact((tx) =>
        tx.insertRoutineRun({
          id: 'run-1',
          routineId: 'digest',
          scheduledFor: T0,
          outcome: 'started',
          sessionId: 'session-1',
          at: T0,
        }),
      )
      expect(await plane.deleteRoutine({ routineId: 'digest', userId: 'user-2' })).toBe(false)
      expect(await plane.deleteRoutine({ routineId: 'digest', userId: 'user-1' })).toBe(true)
      expect(await plane.readRoutine({ routineId: 'digest', userId: 'user-1' })).toBeUndefined()
      expect(await plane.listRoutineRuns({ routineId: 'digest', limit: 10 })).toEqual([])
      expect(await plane.readSession({ sessionId: 'session-1' })).toMatchObject({
        routineId: 'digest',
      })
      expect(await plane.deleteRoutine({ routineId: 'digest', userId: 'user-1' })).toBe(false)
    })

    it('lists a routine ledger newest-first, bounded by the limit', async () => {
      await plane.createRoutine(routineParams({ routineId: 'digest' }))
      await plane.createRoutine(routineParams({ routineId: 'other' }))
      const ledger = (
        id: string,
        minutes: number,
        routineId = 'digest',
        outcome: RoutineRunOutcome = 'started',
      ) =>
        store.transact((tx) =>
          tx.insertRoutineRun({
            id,
            routineId,
            scheduledFor: at(minutes),
            outcome,
            at: at(minutes),
          }),
        )
      await ledger('run-1', 0)
      await ledger('run-2', 10, 'digest', 'skipped-busy')
      await ledger('run-3', 20)
      await ledger('run-other', 30, 'other')
      const ids = async (limit: number): Promise<string[]> =>
        (await plane.listRoutineRuns({ routineId: 'digest', limit })).map((row) => row.id)
      expect(await ids(10)).toEqual(['run-3', 'run-2', 'run-1'])
      expect(await ids(2)).toEqual(['run-3', 'run-2'])
      expect(await plane.listRoutineRuns({ routineId: 'digest', limit: 1 })).toEqual([
        {
          id: 'run-3',
          routineId: 'digest',
          scheduledFor: at(20),
          outcome: 'started',
          reason: null,
          sessionId: null,
          at: at(20),
        },
      ])
      expect(await plane.listRoutineRuns({ routineId: 'absent', limit: 10 })).toEqual([])
    })
  })
}
