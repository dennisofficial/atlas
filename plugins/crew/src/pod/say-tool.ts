import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { crewRefusal } from './outcome'

const inputSchema = z.strictObject({
  agentId: z.string().min(1),
  text: z.string().min(1),
})

const description = [
  'Send another message to a sub-agent you started.',
  'A sub-agent that is mid-step queues the message. It reads the message before its next step.',
  'A sub-agent that has stopped takes the message and runs again.',
  'Its answer reaches you when it stops.',
].join(' ')

export class AgentSayTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'agent_say'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const said = await this.ctx.crew.say({ agentId: input.agentId, text: input.text })
      return {
        ok: true,
        output: { agentId: input.agentId, queued: said.queued },
        modelText: said.queued
          ? `Sub-agent ${input.agentId} is mid-step, so it queues your message and reads it before its next step.`
          : `Sub-agent ${input.agentId} took your message and is running again. Its answer reaches you when it stops.`,
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
