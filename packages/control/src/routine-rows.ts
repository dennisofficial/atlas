export type RoutineRow = {
  routineId: string
  userId: string
  projectId: string
  name: string
  prompt: string
  cron: string
  timezone: string
  enabled: boolean
  modelRef: string | null
  modelEffort: string | null
  modelFast: boolean | null
  nextRunAt: string
  lastRunAt: string | null
  lastSessionId: string | null
  createdAt: string
  updatedAt: string
}

export type RoutineRunOutcome = 'started' | 'skipped-busy' | 'skipped' | 'failed'

export type AdvanceRoutineParams = {
  routineId: string
  expectedNextRunAt: string
  nextRunAt: string
  lastRunAt?: string | undefined
  lastSessionId?: string | undefined
  at: string
}

export type InsertRoutineRunParams = {
  id: string
  routineId: string
  scheduledFor: string
  outcome: RoutineRunOutcome
  reason?: string | undefined
  sessionId?: string | undefined
  at: string
}

export type ListDueRoutinesParams = { now: string; limit: number }

export type RoutineRunRow = {
  id: string
  routineId: string
  scheduledFor: string
  outcome: RoutineRunOutcome
  reason: string | null
  sessionId: string | null
  at: string
}

export type ListRoutinesParams = { userId: string; projectId?: string | undefined }

export type ReadRoutineForUserParams = { routineId: string; userId: string }

export type ListRoutineRunsParams = { routineId: string; limit: number }
