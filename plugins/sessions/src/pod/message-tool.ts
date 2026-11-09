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
  sessionId: z.string().min(1),
  text: z.string().min(1),
})

const description = [
  'Send a peer session a message. A peer is a full session in the same sandbox and workspace,',
  'not a sub-agent: it keeps its own conversation, its answer arrives as a message from it, and',
  'the spawner may send it 20 messages before the operator has to reset that budget.',
].join(' ')

export class MessageSessionTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'message_session'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const sent = await this.ctx.sessions.message({ sessionId: input.sessionId, text: input.text })
      if ('refused' in sent) return { ok: false, reason: sent.refused }
      return {
        ok: true,
        output: { ok: true },
        modelText: `Your message to session ${input.sessionId} is queued; it reads it at its next turn.`,
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
