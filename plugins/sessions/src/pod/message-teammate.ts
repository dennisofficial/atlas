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
  teammateId: z.string().min(1),
  text: z.string().min(1),
})

const description = [
  'Message one of this session’s nested teammates, which reports back to you; any session that is',
  'not a nested teammate of this one is refused.',
].join(' ')

export class MessageTeammateTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'message_teammate'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const sent = await this.ctx.sessions.messageTeammate({
        sessionId: input.teammateId,
        text: input.text,
      })
      if ('refused' in sent) return { ok: false, reason: sent.refused }
      return {
        ok: true,
        output: { ok: true },
        modelText: `Your message to teammate ${input.teammateId} is queued; it reads it at its next turn.`,
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
