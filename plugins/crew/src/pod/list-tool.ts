import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { crewRefusal } from './outcome'

const inputSchema = z.strictObject({})

const description = [
  'List the sub-agents you have started, running and finished alike.',
  'Each entry names its agentId, its type, its intent and how it ended,',
  'with its turns, its tool calls and the last tool it used.',
].join(' ')

const lineOf = (snapshot: SubagentSnapshot): string => {
  const head = `${snapshot.agentId}  ${snapshot.agentType}  ${snapshot.intent}  ${snapshot.status}`
  const counts = `, turns ${snapshot.turns}, tool calls ${snapshot.toolCalls}`
  return snapshot.lastTool === undefined
    ? `${head}${counts}`
    : `${head}${counts}, last tool ${snapshot.lastTool}`
}

export class AgentListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'agent_list'
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
      const snapshots = this.ctx.crew.list()
      if (snapshots.length === 0) {
        return {
          ok: true,
          output: { agents: [] },
          modelText: 'You have started no sub-agents.',
        }
      }
      return {
        ok: true,
        output: {
          agents: snapshots.map((snapshot) => ({
            agentId: snapshot.agentId,
            agentType: snapshot.agentType,
            intent: snapshot.intent,
            status: snapshot.status,
            turns: snapshot.turns,
            toolCalls: snapshot.toolCalls,
          })),
        },
        modelText: snapshots.map(lineOf).join('\n'),
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
