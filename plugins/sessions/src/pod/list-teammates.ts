import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext, SessionBrief } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { lineOf } from './brief-lines'
import { sessionsRefusal } from './outcome'

const inputSchema = z.strictObject({})

const description = [
  'List this session’s nested teammates, newest first, with each one’s id, title and whether it',
  'is working, idle, failed or archived, so a main session can see its workstream.',
].join(' ')

const linesOf = (teammates: readonly SessionBrief[]): string[] =>
  teammates.length === 0 ? ['This session has no teammates.'] : teammates.map(lineOf)

export class ListTeammatesTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'list_teammates'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run(_args: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const teammates = await this.ctx.sessions.teammates()
      return {
        ok: true,
        output: { teammates },
        modelText: linesOf(teammates).join('\n'),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
