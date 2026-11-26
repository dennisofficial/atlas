import type { JsonValue } from '@dltech/atlas-core'
import { z } from 'zod'

import type { RoutineRow } from './routine-rows'
import type { SessionModelRow } from './session-rows'

const storedRoutineSchema = z.object({
  routineId: z.string(),
  userId: z.string(),
  projectId: z.string(),
  name: z.string(),
  prompt: z.string(),
  cron: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  modelRef: z.string().nullable(),
  modelEffort: z.string().nullable(),
  modelFast: z.boolean().nullable(),
  nextRunAt: z.string(),
  lastRunAt: z.string().nullable(),
  lastSessionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const storedRemovalSchema = z.object({ removed: z.boolean() })

const storedSessionSchema = z.object({
  sessionId: z.string(),
  inboxId: z.number(),
  modelRef: z.string(),
  modelEffort: z.string(),
  modelFast: z.boolean(),
})

export const replayedRoutineOf = (result: JsonValue): RoutineRow =>
  storedRoutineSchema.parse(result)

export const storedRoutineOf = (row: RoutineRow): JsonValue => row

export const storedMaybeRoutineOf = (row: RoutineRow | undefined): JsonValue => row ?? null

export const replayedMaybeRoutineOf = (result: JsonValue): RoutineRow | undefined =>
  result === null ? undefined : storedRoutineSchema.parse(result)

export const removalReceiptOf = (removed: boolean): JsonValue => ({ removed })

export const replayedRemovalOf = (result: JsonValue): boolean =>
  storedRemovalSchema.parse(result).removed

export const storedSessionOf = (
  created: { sessionId: string; inboxId: number } & SessionModelRow,
): JsonValue => created

export const replayedSessionOf = (
  result: JsonValue,
): { sessionId: string; inboxId: number } & SessionModelRow => storedSessionSchema.parse(result)
