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

const inputSchema = z
  .strictObject({
    routineId: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
    prompt: z.string().min(1).max(20_000).optional(),
    cron: z.string().min(1).max(120).optional(),
    timezone: z.string().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    model: z.string().min(1).nullable().optional(),
    effort: z.string().min(1).nullable().optional(),
    fast: z.boolean().nullable().optional(),
  })
  .refine(
    (input) =>
      Object.entries(input).some(([key, value]) => key !== 'routineId' && value !== undefined),
    {
      message: 'pass at least one of name, prompt, cron, timezone, enabled, model, effort or fast',
    },
  )

const description = [
  'Change a routine: its name, prompt, cron, timezone, enabled flag or model settings. Pass only the fields that change, at least one of them.',
  'enabled false pauses a routine without deleting it; enabled true resumes it and the API recomputes the next run.',
  'model, effort and fast set to null fall back to the project default for that run.',
  'Use routine_list to find the routineId.',
  ...SCHEDULING,
].join(' ')

export class RoutineUpdateTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_update'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const routine = await this.ctx.control.routines.update(input)
      return done({
        text: `Updated routine ${routine.name} (${routine.routineId}): "${routine.cron}" in ${routine.timezone}, ${routine.enabled ? 'enabled' : 'paused'}, next run ${routine.nextRunAt}.`,
        output: routine,
      })
    } catch (error) {
      return routineRefusal(error)
    }
  }
}
