import { z } from 'zod'

import type { ApiClient } from '@dltech/atlas-api-router'
import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { cloudCall } from '../../cloud/api-trpc-client'
import {
  done,
  isFailure,
  reasonOf,
  SCHEDULING,
  scopeOf,
  type RoutineToolDeps,
  failed,
} from '../../routines/tool-deps'

const inputSchema = z.strictObject({})

const description = [
  "List the routines saved in this session's Atlas Cloud project, with each routine's id, name, cron, timezone, whether it is enabled, when it next runs and the session its last run started.",
  ...SCHEDULING,
].join(' ')

type RoutineRow = Awaited<ReturnType<ApiClient['routines']['list']['query']>>['routines'][number]

const lineFor = (routine: RoutineRow): string =>
  `${routine.routineId}  ${routine.name}  ${routine.cron} in ${routine.timezone}  ${
    routine.enabled ? 'enabled' : 'paused'
  }  next ${routine.nextRunAt}  last session ${routine.lastSessionId ?? 'none'}`

const listingOf = (routines: readonly RoutineRow[]): ToolOutcome =>
  done({
    text:
      routines.length === 0
        ? 'This project has no routines.'
        : `Routines:\n${routines.map(lineFor).join('\n')}`,
    output: {
      routines: routines.map((routine) => ({
        routineId: routine.routineId,
        name: routine.name,
        cron: routine.cron,
        timezone: routine.timezone,
        enabled: routine.enabled,
        nextRunAt: routine.nextRunAt,
        lastSessionId: routine.lastSessionId,
      })),
    },
  })

export class RoutineListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly deps: RoutineToolDeps) {
    super()
  }

  protected override async run({ threadId }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const scope = await scopeOf({ deps: this.deps, threadId })
    if (isFailure(scope)) return scope
    try {
      const body = await cloudCall(scope.api.routines.list.query({}))
      return listingOf(body.routines.filter((routine) => routine.projectId === scope.projectId))
    } catch (error) {
      return failed(reasonOf(error))
    }
  }
}
