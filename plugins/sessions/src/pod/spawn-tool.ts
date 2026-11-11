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
})

const description = [
  'Create an independent session of the operator’s: its own sandbox, its own clone and its own',
  'conversation, appearing at the top level of their sidebar beside this one, the same as one',
  'made with the new-session button, so `brief` is its first message and the whole of what it',
  'knows of this conversation. You are not responsible for it, and it reports to no one.',
].join(' ')

const modelTextOf = (args: { sessionId: string; briefed: boolean }): string =>
  args.briefed
    ? `Started session ${args.sessionId}; your brief is its first message.`
    : `Started session ${args.sessionId} with no brief, so it waits for a message.`

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
        nested: false,
      })
      return {
        ok: true,
        output: {
          sessionId: spawned.sessionId,
          mainThreadId: spawned.mainThreadId,
        },
        modelText: modelTextOf({
          sessionId: spawned.sessionId,
          briefed: input.brief !== undefined && input.brief.trim() !== '',
        }),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
