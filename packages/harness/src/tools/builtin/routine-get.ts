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
  failed,
  isFailure,
  reasonOf,
  SCHEDULING,
  scopeOf,
  type RoutineToolDeps,
} from '../../routines/tool-deps'

const inputSchema = z.strictObject({ routineId: z.string().min(1) })

const description = [
  "Read one routine saved in this session's Atlas Cloud project: its name, cron, timezone, whether it is enabled, its model settings, when it next runs, the session its last run started and the full prompt it runs.",
  'Use routine_list to find the routineId, and routine_get before routine_update when the prompt or the settings matter.',
  ...SCHEDULING,
].join(' ')

type RoutineRow = Awaited<ReturnType<ApiClient['routines']['get']['query']>>

const settingsOf = (routine: RoutineRow): string =>
  `model ${routine.model ?? 'from the project default'}, effort ${
    routine.effort ?? 'from the project default'
  }, fast ${routine.fast === null ? 'from the project default' : String(routine.fast)}`

const detailOf = (routine: RoutineRow): ToolOutcome =>
  done({
    text: [
      `Routine ${routine.name} (${routine.routineId}): "${routine.cron}" in ${routine.timezone}, ${
        routine.enabled ? 'enabled' : 'paused'
      }, next run ${routine.nextRunAt}, last session ${routine.lastSessionId ?? 'none'}.`,
      `Settings: ${settingsOf(routine)}.`,
      `Prompt:\n${routine.prompt}`,
    ].join('\n'),
    output: routine,
  })

export class RoutineGetTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_get'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly deps: RoutineToolDeps) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const scope = await scopeOf({ deps: this.deps, threadId })
    if (isFailure(scope)) return scope
    try {
      const routine = await cloudCall(
        scope.api.routines.get.query({ routineId: input.routineId, projectId: scope.projectId }),
      )
      return detailOf(routine)
    } catch (error) {
      return failed(reasonOf(error))
    }
  }
}
