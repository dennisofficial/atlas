import { randomUUID } from 'node:crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import {
  ControlPlane,
  type RoutineRow,
  type RoutineRunRow as ControlRoutineRunRow,
} from '@dltech/atlas-control'
import {
  INBOX_KIND_MESSAGE,
  type Routine,
  type RoutineCreateInput,
  type RoutineListOutput,
  type RoutineRunOutput,
  type RoutineRunRow,
  type RoutineRunsOutput,
  type RoutineUpdateInput,
} from '@dltech/atlas-protocol'
import {
  type Cron,
  CronNeverFiresError,
  minimumGapMinutes,
  nextOccurrenceAfter,
  parseCron,
} from '@dltech/atlas-schedule'
import { TRPCError } from '@trpc/server'
import { ProjectAccess } from './project-access'

const MINIMUM_GAP_MINUTES = 5

const knownTimezone = (timezone: string): void => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `unknown timezone: ${timezone}` })
  }
}

const checkedCron = ({ cron, timezone }: { cron: string; timezone: string }): Cron => {
  const parsed = parseCron(cron)
  if (!parsed.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `cron: ${parsed.reason}` })
  knownTimezone(timezone)
  if (minimumGapMinutes(parsed.cron) < MINIMUM_GAP_MINUTES) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `a routine runs at most every ${MINIMUM_GAP_MINUTES} minutes`,
    })
  }
  return parsed.cron
}

const nextRunOf = ({
  cron,
  timezone,
  after,
}: {
  cron: Cron
  timezone: string
  after: Date
}): string => {
  try {
    return nextOccurrenceAfter({ cron, after, timezone }).toISOString()
  } catch (error) {
    if (error instanceof CronNeverFiresError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
    }
    throw error
  }
}

const routineOf = (row: RoutineRow): Routine => ({
  routineId: row.routineId,
  projectId: row.projectId,
  name: row.name,
  prompt: row.prompt,
  cron: row.cron,
  timezone: row.timezone,
  enabled: row.enabled,
  model: row.modelRef,
  effort: row.modelEffort,
  fast: row.modelFast,
  nextRunAt: row.nextRunAt,
  lastRunAt: row.lastRunAt,
  lastSessionId: row.lastSessionId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const runOf = (row: ControlRoutineRunRow): RoutineRunRow => ({
  runId: row.id,
  scheduledFor: row.scheduledFor,
  outcome: row.outcome,
  reason: row.reason,
  sessionId: row.sessionId,
  at: row.at,
})

@Injectable()
export class RoutinesService {
  constructor(
    private readonly plane: ControlPlane,
    private readonly projects: ProjectAccess,
  ) {}

  private async owned(args: { userId: string; routineId: string }): Promise<RoutineRow> {
    const row = await this.plane.readRoutine({ routineId: args.routineId, userId: args.userId })
    if (row === undefined) throw new NotFoundException('routine not found')
    return row
  }

  private async accessibleProject(args: { userId: string; projectId: string }): Promise<void> {
    const owner = await this.projects.ownerOf({ projectId: args.projectId })
    if (owner !== args.userId) throw new NotFoundException('project not found')
  }

  async list(args: { userId: string; projectId?: string | undefined }): Promise<RoutineListOutput> {
    const rows = await this.plane.listRoutines({
      userId: args.userId,
      projectId: args.projectId,
    })
    return { routines: rows.map(routineOf) }
  }

  async create(args: { userId: string; input: RoutineCreateInput }): Promise<Routine> {
    await this.accessibleProject({ userId: args.userId, projectId: args.input.projectId })
    const cron = checkedCron({ cron: args.input.cron, timezone: args.input.timezone })
    const now = new Date()
    const at = now.toISOString()
    const row: RoutineRow = {
      routineId: randomUUID(),
      userId: args.userId,
      projectId: args.input.projectId,
      name: args.input.name,
      prompt: args.input.prompt,
      cron: args.input.cron,
      timezone: args.input.timezone,
      enabled: args.input.enabled ?? true,
      modelRef: args.input.model ?? null,
      modelEffort: args.input.effort ?? null,
      modelFast: args.input.fast ?? null,
      nextRunAt: nextRunOf({ cron, timezone: args.input.timezone, after: now }),
      lastRunAt: null,
      lastSessionId: null,
      createdAt: at,
      updatedAt: at,
    }
    await this.plane.createRoutine(row)
    return routineOf(row)
  }

  async update(args: { userId: string; input: RoutineUpdateInput }): Promise<Routine> {
    const row = await this.owned({ userId: args.userId, routineId: args.input.routineId })
    const cron = args.input.cron ?? row.cron
    const timezone = args.input.timezone ?? row.timezone
    const rescheduled = args.input.cron !== undefined || args.input.timezone !== undefined
    const enabling = args.input.enabled === true && !row.enabled
    const parsed = checkedCron({ cron, timezone })
    const at = new Date().toISOString()
    const changed = await this.plane.updateRoutine({
      routineId: row.routineId,
      userId: args.userId,
      patch: {
        ...(args.input.name === undefined ? {} : { name: args.input.name }),
        ...(args.input.prompt === undefined ? {} : { prompt: args.input.prompt }),
        ...(args.input.cron === undefined ? {} : { cron: args.input.cron }),
        ...(args.input.timezone === undefined ? {} : { timezone: args.input.timezone }),
        ...(args.input.enabled === undefined ? {} : { enabled: args.input.enabled }),
        ...(args.input.model === undefined ? {} : { modelRef: args.input.model }),
        ...(args.input.effort === undefined ? {} : { modelEffort: args.input.effort }),
        ...(args.input.fast === undefined ? {} : { modelFast: args.input.fast }),
      },
      ...(rescheduled || enabling
        ? { nextRunAt: nextRunOf({ cron: parsed, timezone, after: new Date(at) }) }
        : {}),
      at,
    })
    if (changed === undefined) throw new NotFoundException('routine not found')
    return routineOf(changed)
  }

  async remove(args: { userId: string; routineId: string }): Promise<{ removed: boolean }> {
    const removed = await this.plane.deleteRoutine({
      routineId: args.routineId,
      userId: args.userId,
    })
    return { removed }
  }

  async runs(args: {
    userId: string
    routineId: string
    limit?: number | undefined
  }): Promise<RoutineRunsOutput> {
    await this.owned({ userId: args.userId, routineId: args.routineId })
    const rows = await this.plane.listRoutineRuns({
      routineId: args.routineId,
      limit: args.limit ?? 20,
    })
    return { runs: rows.map(runOf) }
  }

  async runNow(args: { userId: string; routineId: string }): Promise<RoutineRunOutput> {
    const row = await this.owned({ userId: args.userId, routineId: args.routineId })
    const sessionId = randomUUID()
    await this.plane.createSessionWithMessage({
      sessionId,
      mainThreadId: randomUUID(),
      userId: args.userId,
      projectId: row.projectId,
      title: row.name,
      modelRef: row.modelRef ?? undefined,
      modelEffort: row.modelEffort ?? undefined,
      modelFast: row.modelFast ?? undefined,
      routineId: row.routineId,
      message: {
        kind: INBOX_KIND_MESSAGE,
        payload: JSON.stringify({ text: row.prompt }),
      },
    })
    return { sessionId }
  }
}
