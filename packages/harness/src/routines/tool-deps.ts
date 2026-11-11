import type { ApiClient } from '@dltech/atlas-api-router'
import type { ThreadId, ToolOutcome } from '@dltech/atlas-core'

import type { RoutineAccessSource } from './routine-access'

export type RoutineToolDeps = {
  access: RoutineAccessSource
}

export type RoutineScope = {
  api: ApiClient
  projectId: string
}

export const NOT_SIGNED_IN = 'Not signed in to Atlas Cloud'

export const NOT_IN_A_PROJECT =
  'this session has no Atlas Cloud project, and routines belong to a project'

export const SCHEDULING: readonly string[] = [
  'A routine schedules a saved prompt to run on a cron in a fresh session each run; it is not a reminder kept in this conversation.',
  'cron is five fields — minute hour day-of-month month weekday — read in the routine\'s IANA timezone, so "0 9 * * 1-5" is 09:00 on weekdays.',
  'The API rejects a cron that would run more often than every 5 minutes, a cron it cannot parse, and an unknown timezone.',
  'Routines are listed on the Routines page in the Atlas web app.',
]

export const failed = (reason: string): ToolOutcome => ({ ok: false, reason })

export const done = (args: { text: string; output: unknown }): ToolOutcome => ({
  ok: true,
  output: args.output,
  modelText: args.text,
})

export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const isFailure = (value: RoutineScope | ToolOutcome): value is ToolOutcome =>
  'reason' in value

export const scopeOf = async (args: {
  deps: RoutineToolDeps
  threadId: ThreadId
}): Promise<RoutineScope | ToolOutcome> => {
  const access = await args.deps.access({ threadId: args.threadId })
  if (access === null) return failed(NOT_SIGNED_IN)
  if (access.projectId === null) return failed(NOT_IN_A_PROJECT)
  return { api: access.api, projectId: access.projectId }
}
