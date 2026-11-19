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

const inputSchema = z.strictObject({})

const description = [
  "List the routines saved in this session's project, with each routine's id, name, cron, timezone, whether it is enabled, when it next runs and the session its last run started.",
  ...SCHEDULING,
].join(' ')

const lineFor = (routine: Routine): string =>
  `${routine.routineId}  ${routine.name}  ${routine.cron} in ${routine.timezone}  ${
    routine.enabled ? 'enabled' : 'paused'
  }  next ${routine.nextRunAt}  last session ${routine.lastSessionId ?? 'none'}`

const summaryOf = (routine: Routine) => ({
  routineId: routine.routineId,
  name: routine.name,
  cron: routine.cron,
  timezone: routine.timezone,
  enabled: routine.enabled,
  nextRunAt: routine.nextRunAt,
  lastSessionId: routine.lastSessionId,
})

export class RoutineListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'routine_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run(): Promise<ToolOutcome> {
    try {
      const routines = await this.ctx.control.routines.list()
      return done({
        text:
          routines.length === 0
            ? 'This project has no routines.'
            : `Routines:\n${routines.map(lineFor).join('\n')}`,
        output: { routines: routines.map(summaryOf) },
      })
    } catch (error) {
      return routineRefusal(error)
    }
  }
}

export type { ToolRun }
