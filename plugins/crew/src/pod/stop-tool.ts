import {
  EAgentStatus,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { crewRefusal } from './outcome'

const inputSchema = z.strictObject({ agentId: z.string().min(1) })

const description = [
  'Stop a sub-agent you started.',
  'It ends after the step it is taking, and you are handed how it ended.',
  'Stopping one that has already ended changes nothing.',
].join(' ')

const hadEnded = (before: SubagentSnapshot): boolean =>
  before.status === EAgentStatus.Finished ||
  before.status === EAgentStatus.Failed ||
  before.status === EAgentStatus.Stopped

export class AgentStopTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'agent_stop'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const before = this.ctx.crew.list().find((snapshot) => snapshot.agentId === input.agentId)
    try {
      const snapshot = await this.ctx.crew.stop({ agentId: input.agentId })
      return {
        ok: true,
        output: { agentId: snapshot.agentId, status: snapshot.status },
        modelText:
          before !== undefined && hadEnded(before)
            ? `Agent ${input.agentId} had already ended (${before.status}), so nothing was interrupted.`
            : `Signalled agent ${input.agentId} to stop. It ends after the step it is taking, and you will be handed how it ended.`,
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
