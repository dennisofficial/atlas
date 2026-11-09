import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext, SessionBrief } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { sessionsRefusal } from './outcome'

const inputSchema = z.strictObject({})

const description = [
  'List the operator’s sessions, newest first, with the current one marked. Each one is an',
  'independent session with its own sandbox and conversation, and each line names its id, its',
  'title, whether it is archived and whether it is this session.',
].join(' ')

const lineOf = (brief: SessionBrief): string => {
  const title = brief.title ?? 'untitled'
  const state = brief.archivedAt === null ? 'open' : `archived ${brief.archivedAt}`
  const current = brief.current ? '  current' : ''
  return `${brief.sessionId}  ${title}  ${state}${current}`
}

const linesOf = (sessions: readonly SessionBrief[]): string[] =>
  sessions.length === 0 ? ['The operator has no sessions.'] : sessions.map(lineOf)

export class ListSessionsTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'list_sessions'
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
      const sessions = await this.ctx.sessions.list()
      return {
        ok: true,
        output: { sessions },
        modelText: linesOf(sessions).join('\n'),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
