import { randomUUID } from 'node:crypto'

import { ESessionStatus, type PluginViewFold, type V2Event } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import type { z } from 'zod'

import { postIn } from './inbox-ops'
import type { LeaseOps } from './lease-ops'
import type { ControlTx, RoutineRow, RoutineRunOutcome } from './port'
import { currentViewIn, liveViewIn } from './session-view-read'
import { createSessionIn } from './session-ops'

export type RunRoutineParams = {
  routineId: string
  scheduledFor: string
  now: string
  wedgedAfterMs: number
  nextOccurrence: (args: { after: string }) => string
  createSessionId: () => { sessionId: string; mainThreadId: string }
}

export type RunRoutineResult = {
  outcome: RoutineRunOutcome
  sessionId?: string | undefined
  reason?: string | undefined
}

const finishedStates: ReadonlySet<ESessionStatus> = new Set([
  ESessionStatus.Idle,
  ESessionStatus.Failed,
  ESessionStatus.StartFailed,
  ESessionStatus.SetupFailed,
])

const isWedged = (params: {
  live: boolean
  since: string | undefined
  now: string
  wedgedAfterMs: number
}): boolean =>
  params.live === false &&
  params.since !== undefined &&
  Date.parse(params.now) - Date.parse(params.since) > params.wedgedAfterMs

const busyStateOf = async (params: {
  tx: ControlTx
  leases: LeaseOps
  routine: RoutineRow
  now: string
  wedgedAfterMs: number
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<ESessionStatus | undefined> => {
  const lastSessionId = params.routine.lastSessionId
  if (lastSessionId === null) return undefined
  const session = await params.tx.readSession({ sessionId: lastSessionId })
  if (session === undefined) return undefined
  const threadId = session.mainThreadId
  const state = await currentViewIn({
    tx: params.tx,
    sessionId: lastSessionId,
    threadId,
    eventSchema: params.eventSchema,
    pluginViews: params.pluginViews,
  })
  const live = await liveViewIn({
    tx: params.tx,
    leases: params.leases,
    sessionId: lastSessionId,
    threadId,
    state,
    now: params.now,
    eventSchema: params.eventSchema,
  })
  const status = live.value.status
  if (finishedStates.has(status.state)) return undefined
  const wedged = isWedged({
    live: live.live,
    since: status.since,
    now: params.now,
    wedgedAfterMs: params.wedgedAfterMs,
  })
  return wedged ? undefined : status.state
}

const laterOccurrence = (params: { scheduledFor: string; now: string }): string =>
  Date.parse(params.now) > Date.parse(params.scheduledFor) ? params.now : params.scheduledFor

export const runRoutineIn = async (
  params: RunRoutineParams & {
    tx: ControlTx
    leases: LeaseOps
    eventSchema?: z.ZodType<V2Event> | undefined
    pluginViews?: readonly PluginViewFold[] | undefined
  },
): Promise<RunRoutineResult> => {
  const { tx, routineId, scheduledFor, now } = params
  const routine = await tx.lockRoutine(routineId)
  if (routine === undefined) return { outcome: 'skipped', reason: 'routine-not-found' }

  const skip = async (reason: string, advance: boolean): Promise<RunRoutineResult> => {
    await tx.insertRoutineRun({
      id: randomUUID(),
      routineId,
      scheduledFor,
      outcome: advance ? 'skipped-busy' : 'skipped',
      reason,
      at: now,
    })
    if (advance) {
      await tx.advanceRoutine({
        routineId,
        expectedNextRunAt: routine.nextRunAt,
        nextRunAt: params.nextOccurrence({ after: scheduledFor }),
        at: now,
      })
    }
    return { outcome: advance ? 'skipped-busy' : 'skipped', reason }
  }

  if (!routine.enabled) return skip('disabled', false)
  if (Date.parse(routine.nextRunAt) > Date.parse(scheduledFor)) return skip('already-ran', false)

  const busy = await busyStateOf({
    tx,
    leases: params.leases,
    routine,
    now,
    wedgedAfterMs: params.wedgedAfterMs,
    eventSchema: params.eventSchema,
    pluginViews: params.pluginViews,
  })
  if (busy !== undefined) return skip(busy, true)

  const { sessionId, mainThreadId } = params.createSessionId()
  await createSessionIn({
    tx,
    sessionId,
    mainThreadId,
    userId: routine.userId,
    projectId: routine.projectId,
    title: routine.name,
    modelRef: routine.modelRef ?? undefined,
    modelEffort: routine.modelEffort ?? undefined,
    modelFast: routine.modelFast ?? undefined,
    at: now,
  })
  await postIn({
    tx,
    sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text: routine.prompt }),
    at: now,
  })
  await tx.insertRoutineRun({
    id: randomUUID(),
    routineId,
    scheduledFor,
    outcome: 'started',
    sessionId,
    at: now,
  })
  await tx.advanceRoutine({
    routineId,
    expectedNextRunAt: routine.nextRunAt,
    nextRunAt: params.nextOccurrence({
      after: laterOccurrence({ scheduledFor, now }),
    }),
    lastRunAt: now,
    lastSessionId: sessionId,
    at: now,
  })
  return { outcome: 'started', sessionId }
}
