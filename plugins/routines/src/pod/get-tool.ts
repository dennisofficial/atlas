import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { Routine } from '@dltech/atlas-protocol'
import { z } from 'zod'

import { done, routineRefusal } from './outcome'
import { SCHEDULING } from './scheduling'

const inputSchema = z.strictObject({ routineId: z.string().min(1) })

const description = [
  "Read one routine saved in this session's project. The result gives its name, cron, timezone, whether it is enabled, its model settings, when it next runs, the session its last run started and the full prompt it runs.",
  'Use routine_list to find the routineId. Call routine_get before routine_update when the prompt or the settings matter.',
  ...SCHEDULING,
].join(' ')

const settingsOf = (routine: Routine): string =>
  `model ${routine.model ?? 'from the project default'}, effort ${
    routine.effort ?? 'from the project default'
  }, fast ${routine.fast === null ? 'from the project default' : String(routine.fast)}`

const detailOf = (routine: Routine): ToolOutcome =>
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

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const routine = await this.ctx.control.routines.get({ routineId: input.routineId })
      return detailOf(routine)
    } catch (error) {
      return routineRefusal(error)
    }
  }
}
