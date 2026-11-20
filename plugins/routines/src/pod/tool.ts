import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutines,
  runRoutine,
  updateRoutine,
} from './actions'
import { ROUTINE_DESCRIPTION } from './description'
import { ERoutineAction, type RoutineInput, routineInputSchema } from './schema'

export class RoutineTool extends SchemaTool<typeof routineInputSchema> {
  readonly name = 'routine'
  readonly description = ROUTINE_DESCRIPTION
  readonly effect = EToolEffect.Write
  override readonly isConcurrencySafe = (input: RoutineInput) =>
    input.action === ERoutineAction.List || input.action === ERoutineAction.Get
  readonly inputSchema = routineInputSchema
  readonly deferred = true
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({
    input,
  }: ToolRun<typeof routineInputSchema>): Promise<ToolOutcome> {
    switch (input.action) {
      case ERoutineAction.List:
        return listRoutines(this.ctx)
      case ERoutineAction.Get:
        return getRoutine({ ctx: this.ctx, input })
      case ERoutineAction.Create:
        return createRoutine({ ctx: this.ctx, input })
      case ERoutineAction.Update:
        return updateRoutine({ ctx: this.ctx, input })
      case ERoutineAction.Delete:
        return deleteRoutine({ ctx: this.ctx, input })
      case ERoutineAction.Run:
        return runRoutine({ ctx: this.ctx, input })
    }
  }
}
