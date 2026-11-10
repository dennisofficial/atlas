import type { RoutineRow } from '@dltech/atlas-control'
import type { RoutineGraph, RoutineTxPort } from '../trigger/routine/routine-graph'

export const routineRowOf = (overrides: Partial<RoutineRow> = {}): RoutineRow => ({
  routineId: 'rtn_1',
  userId: 'usr_1',
  projectId: 'prj_1',
  name: 'Nightly triage',
  prompt: 'Triage the open pull requests.',
  cron: '0 3 * * *',
  timezone: 'UTC',
  enabled: true,
  modelRef: null,
  modelEffort: null,
  modelFast: null,
  nextRunAt: '2026-11-10T03:00:00.000Z',
  lastRunAt: null,
  lastSessionId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

export type DueRead = { now: string | undefined; limit: number | undefined }

export const sweepGraphOf = (params: {
  rows: readonly RoutineRow[]
  read?: DueRead
}): RoutineGraph => ({
  store: {
    listDueRoutines: async ({ now, limit }) => {
      if (params.read !== undefined) {
        params.read.now = now
        params.read.limit = limit
      }
      return [...params.rows]
    },
    transact: async () => {
      throw new Error('the sweep never writes')
    },
  },
  plane: {
    runRoutine: async () => {
      throw new Error('the sweep never runs a routine')
    },
  },
})

export type WriteRecord = {
  advanced: { routineId: string; expectedNextRunAt: string; nextRunAt: string; at: string }[]
  runs: { routineId: string; scheduledFor: string; outcome: string; reason?: string | undefined }[]
  nextRunAt?: string | undefined
}

export const runGraphOf = (params: {
  routine: RoutineRow | undefined
  advanced?: boolean
  writes?: WriteRecord
  runRoutine?: RoutineGraph['plane']['runRoutine']
}): RoutineGraph => {
  const writes: WriteRecord = params.writes ?? { advanced: [], runs: [] }
  if (writes.nextRunAt === undefined) writes.nextRunAt = params.routine?.nextRunAt
  const tx: RoutineTxPort = {
    readRoutine: async () =>
      params.routine === undefined
        ? undefined
        : { ...params.routine, nextRunAt: writes.nextRunAt ?? params.routine.nextRunAt },
    advanceRoutine: async (advance) => {
      writes.advanced.push({
        routineId: advance.routineId,
        expectedNextRunAt: advance.expectedNextRunAt,
        nextRunAt: advance.nextRunAt,
        at: advance.at,
      })
      const won = params.advanced ?? advance.expectedNextRunAt === writes.nextRunAt
      if (won) writes.nextRunAt = advance.nextRunAt
      return won
    },
    insertRoutineRun: async (run) => {
      writes.runs.push({
        routineId: run.routineId,
        scheduledFor: run.scheduledFor,
        outcome: run.outcome,
        reason: run.reason,
      })
    },
  }

  return {
    store: {
      listDueRoutines: async () => {
        throw new Error('a child never lists due routines')
      },
      transact: async (work) => work(tx),
    },
    plane: {
      runRoutine: params.runRoutine ?? (async () => ({ outcome: 'started', sessionId: 'ses_1' })),
    },
  }
}
