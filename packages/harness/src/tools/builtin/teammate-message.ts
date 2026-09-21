import { z } from 'zod'

import {
  EAgentStatus,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  toThreadId,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { type AgentRegistrySource } from './agent-tokens'

const inputSchema = z.strictObject({
  agentId: z.string().min(1),
  text: z.string().min(1),
})

const description = [
  'Message a teammate: another full session spawned by the same main agent you report to.',
  'Takes the teammate\u2019s agentId. A teammate mid-turn reads your message before its next step; one that has stopped starts running again on it.',
  'This is coordination between peers — share what you learned, hand off a seam, ask what it is seeing. Its lifecycle is not yours: only the main agent spawns or stops a teammate.',
  'The main agent is not a teammate, so it is never a target here — ending your turn is how you report to it, and your last message is what it reads.',
  'Only teammates of the same main agent can be messaged; anything else is refused and the refusal names your teammates.',
].join(' ')

export class TeammateMessageTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'teammate_message'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly agents: AgentRegistrySource) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const agentId = toThreadId(input.agentId)
    const registry = this.agents()
    const before = registry
      .listEverywhere()
      .find((snapshot) => snapshot.agentId === agentId)?.status

    const outcome = await registry.sayToPeer({ agentId, threadId, text: input.text })
    if (!outcome.ok) return outcome

    const queued = before === EAgentStatus.Running

    return {
      ok: true,
      output: { agentId, queued },
      modelText: queued
        ? `Teammate ${agentId} is mid-turn, so your message is queued and it will read it before its next step.`
        : `Teammate ${agentId} took your message and is running again; its turn-end report goes to the main agent.`,
    }
  }
}
