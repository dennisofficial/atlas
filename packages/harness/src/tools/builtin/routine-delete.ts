import { z } from 'zod'

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
  'Delete a routine for good, so it stops being scheduled and leaves the Routines page in the Atlas web app.',
  'Sessions its earlier runs created stay where they are. To stop a routine but keep it, use routine_update with enabled false instead.',
  'Use routine_list to find the routineId.',
  ...SCHEDULING,
].join(' ')

export class RoutineDeleteTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_delete'
  readonly description = description
  readonly effect = EToolEffect.Write
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
      const body = await cloudCall(scope.api.routines.remove.mutate({ routineId: input.routineId }))
      if (!body.removed) return failed(`there is no routine "${input.routineId}" in your account`)
      return done({ text: `Deleted routine ${input.routineId}.`, output: body })
    } catch (error) {
      return failed(reasonOf(error))
    }
  }
}
