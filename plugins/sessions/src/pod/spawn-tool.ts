import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { sessionsRefusal } from './outcome'

const inputSchema = z.strictObject({
  title: z.string().min(1).optional(),
  brief: z.string().min(1).optional(),
  intoPod: z.boolean().optional(),
})

const description = [
  'Create a new session of the operator’s. By default it is a session like one created in the UI:',
  'its own sandbox and a fresh clone, appearing in their sidebar and running on its own, so',
  '`brief` is its first message and the whole of what it knows of this conversation. `intoPod:',
  'true` makes it a teammate instead, sharing your sandbox, workspace and context; a teammate',
  'cannot create another teammate. Message it later with `message_session`.',
].join(' ')

const modelTextOf = (args: { sessionId: string; briefed: boolean; intoPod: boolean }): string => {
  const what = args.intoPod
    ? `teammate ${args.sessionId} in your sandbox`
    : `session ${args.sessionId}`
  return args.briefed
    ? `Started ${what}; your brief is its first message.`
    : `Started ${what} with no brief, so it waits for a message.`
}

export class SpawnSessionTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'spawn_session'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const spawned = await this.ctx.sessions.spawn({
        title: input.title,
        brief: input.brief,
        intoPod: input.intoPod,
      })
      return {
        ok: true,
        output: { sessionId: spawned.sessionId, mainThreadId: spawned.mainThreadId },
        modelText: modelTextOf({
          sessionId: spawned.sessionId,
          briefed: input.brief !== undefined && input.brief.trim() !== '',
          intoPod: input.intoPod === true,
        }),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
