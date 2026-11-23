import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { MessageSent, PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { sessionsRefusal } from './outcome'

const inputSchema = z.strictObject({
  to: z.string().min(1),
  text: z.string().min(1),
})

const description = [
  'Send a plain message to another agent or session.',
  '`to` is an id from agent_spawn, spawn_teammate, spawn_session, agent_list, list_sessions or list_teammates, or "parent" for whoever started you.',
  'The message wakes the receiver.',
  'Use it while you work.',
  "A sub-agent's final answer reaches its parent on its own when it ends, so do not also send it.",
  'It cannot reach the operator: answer the operator in your turn.',
].join(' ')

type Delivered = Extract<MessageSent, { delivered: true }>

const recipientOf = (sent: Delivered): string =>
  sent.name === undefined ? sent.to : `${sent.name} (${sent.to})`

const modelTextOf = (sent: Delivered): string =>
  sent.queued
    ? `Sent to ${recipientOf(sent)}. It is busy, so it reads the message after its current step.`
    : `Sent to ${recipientOf(sent)}.`

export class SendMessageTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'send_message'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const sent = await this.ctx.messages.send({ to: input.to, text: input.text })
      if ('refused' in sent) return { ok: false, reason: sent.refused }
      return {
        ok: true,
        output: {
          to: sent.to,
          ...(sent.name === undefined ? {} : { name: sent.name }),
          queued: sent.queued,
        },
        modelText: modelTextOf(sent),
      }
    } catch (error) {
      return sessionsRefusal(error)
    }
  }
}
