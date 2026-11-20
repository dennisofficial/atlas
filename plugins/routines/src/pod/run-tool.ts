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

const inputSchema = z.strictObject({ routineId: z.string().min(1) })

const description = [
  'Start a routine now, off its schedule. The result gives the id of the session the run created.',
  'The run is a full session of its own. It does not run in this session and you do not see its turn.',
  'The routine keeps its schedule, so its next scheduled run is unaffected.',
  ...SCHEDULING,
].join(' ')

export class RoutineRunTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_run'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const body = await this.ctx.control.routines.run({ routineId: input.routineId })
      return done({
        text: `Started routine ${input.routineId} now in session ${body.sessionId}.`,
        output: body,
      })
    } catch (error) {
      return routineRefusal(error)
    }
  }
}
