import { describe, expect, it } from 'bun:test'

import type { RoutineRow } from '../src/routine-rows'
import type { RoutinePatch } from '../src/routine-crud'
import {
  RoutineInvalidError,
  RoutineNotFoundError,
  routineCreateOf,
  routineListOf,
  routineRemoveOf,
  routineRunNowOf,
  routineUpdateOf,
  type RoutinePlane,
} from '../src/routine-service'

const rowOf = (patch: Partial<RoutineRow> = {}): RoutineRow => ({
  routineId: 'r1',
  userId: 'u1',
  projectId: 'p1',
  name: 'standup',
  prompt: 'post the standup',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
  enabled: true,
  modelRef: null,
  modelEffort: null,
  modelFast: null,
  nextRunAt: '2026-11-20T09:00:00.000Z',
  lastRunAt: null,
  lastSessionId: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  ...patch,
})

const fakePlane = (rows: readonly RoutineRow[] = []) => {
  const routines = new Map(rows.map((row) => [row.routineId, row]))
  const sessions: { userId: string; projectId: string | null; routineId: string | undefined }[] = []
  const plane: RoutinePlane = {
    createRoutine: async (row) => {
      routines.set(row.routineId, row)
      return row
    },
    createSessionWithMessage: async (args) => {
      sessions.push({ userId: args.userId, projectId: args.projectId, routineId: args.routineId })
      return {} as never
    },
    deleteRoutine: async ({ routineId, userId }) => {
      const row = routines.get(routineId)
      if (row === undefined || row.userId !== userId) return false
      routines.delete(routineId)
      return true
    },
    listRoutineRuns: async () => [],
    listRoutines: async ({ userId, projectId }) =>
      [...routines.values()].filter(
        (row) => row.userId === userId && (projectId === undefined || row.projectId === projectId),
      ),
    readRoutine: async ({ routineId, userId }) => {
      const row = routines.get(routineId)
      return row === undefined || row.userId !== userId ? undefined : row
    },
    updateRoutine: async (args) => {
      const row = routines.get(args.routineId)
      if (row === undefined || row.userId !== args.userId) return undefined
      const patch: RoutinePatch = args.patch
      const next: RoutineRow = {
        ...row,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.prompt === undefined ? {} : { prompt: patch.prompt }),
        ...(patch.cron === undefined ? {} : { cron: patch.cron }),
        ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.modelRef === undefined ? {} : { modelRef: patch.modelRef }),
        ...(patch.modelEffort === undefined ? {} : { modelEffort: patch.modelEffort }),
        ...(patch.modelFast === undefined ? {} : { modelFast: patch.modelFast }),
        nextRunAt: args.nextRunAt ?? row.nextRunAt,
        updatedAt: args.at,
      }
      routines.set(next.routineId, next)
      return next
    },
  }
  return { plane, routines, sessions }
}

const input = {
  projectId: 'p1',
  name: 'standup',
  prompt: 'post the standup',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
}

describe('routineCreateOf', () => {
  it('builds the row with its next run in the routine timezone', async () => {
    const { plane, routines } = fakePlane()
    const routine = await routineCreateOf({ plane, userId: 'u1', input })
    expect(routine.name).toBe('standup')
    expect(routine.enabled).toBe(true)
    expect(routines.get(routine.routineId)?.nextRunAt).toBe('2026-11-20T09:00:00.000Z')
  })

  it('rejects a cron that runs more often than every five minutes', async () => {
    const { plane } = fakePlane()
    const failed = routineCreateOf({
      plane,
      userId: 'u1',
      input: { ...input, cron: '*/2 * * * *' },
    })
    await expect(failed).rejects.toBeInstanceOf(RoutineInvalidError)
    await expect(failed).rejects.toThrow('a routine runs at most every 5 minutes')
  })

  it('rejects an unknown timezone', async () => {
    const { plane } = fakePlane()
    await expect(
      routineCreateOf({ plane, userId: 'u1', input: { ...input, timezone: 'Mars/Olympus' } }),
    ).rejects.toThrow('unknown timezone: Mars/Olympus')
  })

  it('rejects a cron it cannot parse', async () => {
    const { plane } = fakePlane()
    await expect(
      routineCreateOf({ plane, userId: 'u1', input: { ...input, cron: 'every morning' } }),
    ).rejects.toBeInstanceOf(RoutineInvalidError)
  })
})

describe('routine scoping', () => {
  it('lists only the routines of the project asked for', async () => {
    const { plane } = fakePlane([rowOf(), rowOf({ routineId: 'r2', projectId: 'p2' })])
    const listed = await routineListOf({ plane, userId: 'u1', projectId: 'p1' })
    expect(listed.routines.map((routine) => routine.routineId)).toEqual(['r1'])
  })

  it('refuses to update a routine of another project', async () => {
    const { plane } = fakePlane()
    await expect(
      routineUpdateOf({
        plane,
        userId: 'u1',
        projectId: 'p2',
        input: { routineId: 'r1', name: 'other' },
      }),
    ).rejects.toBeInstanceOf(RoutineNotFoundError)
  })

  it('refuses to update a routine that is gone', async () => {
    const { plane } = fakePlane()
    await expect(
      routineUpdateOf({ plane, userId: 'u1', input: { routineId: 'gone', name: 'other' } }),
    ).rejects.toThrow('routine not found: gone')
  })

  it('recomputes the next run when a routine is re-enabled', async () => {
    const { plane } = fakePlane([rowOf({ enabled: false })])
    const routine = await routineUpdateOf({
      plane,
      userId: 'u1',
      input: { routineId: 'r1', enabled: true },
    })
    expect(routine.enabled).toBe(true)
    expect(routine.nextRunAt > '2026-11-19T00:00:00.000Z').toBe(true)
  })

  it('removes nothing when the routine belongs to another project', async () => {
    const { plane, routines } = fakePlane([rowOf()])
    const removed = await routineRemoveOf({
      plane,
      userId: 'u1',
      projectId: 'p2',
      routineId: 'r1',
    })
    expect(removed).toEqual({ removed: false })
    expect(routines.size).toBe(1)
  })

  it('runs a routine of this project in a session of that project', async () => {
    const { plane, sessions } = fakePlane([rowOf()])
    const run = await routineRunNowOf({ plane, userId: 'u1', projectId: 'p1', routineId: 'r1' })
    expect(run.sessionId.length).toBeGreaterThan(0)
    expect(sessions).toEqual([{ userId: 'u1', projectId: 'p1', routineId: 'r1' }])
  })

  it('refuses to run a routine of another project', async () => {
    const { plane } = fakePlane()
    await expect(
      routineRunNowOf({ plane, userId: 'u1', projectId: 'p2', routineId: 'r1' }),
    ).rejects.toBeInstanceOf(RoutineNotFoundError)
  })
})
