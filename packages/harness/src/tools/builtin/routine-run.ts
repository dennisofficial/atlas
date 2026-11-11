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
  'Start a routine now, off its schedule, and return the id of the session the run created.',
  'The run is a full session of its own: it does not run in this conversation and you do not see its turn.',
  'The routine keeps its schedule, so its next scheduled run is unaffected.',
  ...SCHEDULING,
].join(' ')

export class RoutineRunTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_run'
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
      const body = await cloudCall(scope.api.routines.runNow.mutate({ routineId: input.routineId }))
      return done({
        text: `Started routine ${input.routineId} now in session ${body.sessionId}.`,
        output: body,
      })
    } catch (error) {
      return failed(reasonOf(error))
    }
  }
}
