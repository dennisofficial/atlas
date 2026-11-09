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
  'Start a peer session: a full session the operator owns, in the same sandbox and workspace as',
  'this one, not a sub-agent. It appears in their sidebar and runs on its own. The peer sees',
  'nothing of this conversation, so `brief` is the whole of its task and arrives as its first',
  'message; without one it starts idle. Message it later with `message_session`.',
].join(' ')

const modelTextOf = (args: { sessionId: string; briefed: boolean }): string =>
  args.briefed
    ? `Started peer session ${args.sessionId}; your brief is its first message.`
    : `Started peer session ${args.sessionId} with no brief, so it waits for a message.`

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
      const spawned = await this.ctx.sessions.spawn({ title: input.title, brief: input.brief })
      return {
        ok: true,
        output: { sessionId: spawned.sessionId, mainThreadId: spawned.mainThreadId },
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
