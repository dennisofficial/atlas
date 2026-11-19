import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { done, routineRefusal } from './outcome'
import { SCHEDULING } from './scheduling'

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
  "Create a routine: a prompt this session's project runs on a cron, in a fresh session, at each scheduled time.",
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

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const routine = await this.ctx.control.routines.create(input)
      return done({
        text: `Created routine ${routine.name} (${routine.routineId}): "${routine.cron}" in ${routine.timezone}, next run ${routine.nextRunAt}${routine.enabled ? '' : ', paused'}.`,
        output: routine,
      })
    } catch (error) {
      return routineRefusal(error)
    }
  }
}
