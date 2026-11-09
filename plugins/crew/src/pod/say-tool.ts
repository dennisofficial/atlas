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
  'Send a sub-agent you started another message.',
  'A sub-agent that is mid-step queues it and reads it before its next step;',
  'one that has stopped takes it and runs again, and its answer reaches you when it stops.',
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
          ? `Agent ${input.agentId} is mid-step, so your message is queued and it will read it before its next one.`
          : `Agent ${input.agentId} took your message and is running again; its answer reaches you when it stops.`,
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
