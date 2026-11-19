import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { done, failed, routineRefusal } from './outcome'
import { SCHEDULING } from './scheduling'

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

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const body = await this.ctx.control.routines.remove({ routineId: input.routineId })
      if (!body.removed) {
        return failed(`there is no routine "${input.routineId}" in this session's project`)
      }
      return done({ text: `Deleted routine ${input.routineId}.`, output: body })
    } catch (error) {
      return routineRefusal(error)
    }
  }
}
