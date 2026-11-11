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

const inputSchema = z.strictObject({
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(20_000),
  cron: z.string().min(1).max(120),
  timezone: z.string().min(1).max(80),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  fast: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

const description = [
  "Create a routine: a prompt this session's Atlas Cloud project runs on a cron, in a fresh session, at each scheduled time.",
  'timezone has no default here, so pass one: an IANA zone such as Europe/London or UTC.',
  'prompt is the whole instruction the agent receives at the start of a run, so write it to stand alone without this conversation.',
  'model, effort and fast pick the model for each run and default to the project setting; enabled defaults to true.',
  "The routine is created in this session's project; there is no way to create one in another project from here.",
  ...SCHEDULING,
].join(' ')

export class RoutineCreateTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_create'
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
      const routine = await cloudCall(
        scope.api.routines.create.mutate({
          projectId: scope.projectId,
          name: input.name,
          prompt: input.prompt,
          cron: input.cron,
          timezone: input.timezone,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.effort === undefined ? {} : { effort: input.effort }),
          ...(input.fast === undefined ? {} : { fast: input.fast }),
        }),
      )
      return done({
        text: `Created routine ${routine.name} (${routine.routineId}): "${routine.cron}" in ${routine.timezone}, next run ${routine.nextRunAt}${routine.enabled ? '' : ', paused'}.`,
        output: routine,
      })
    } catch (error) {
      return failed(reasonOf(error))
    }
  }
}
