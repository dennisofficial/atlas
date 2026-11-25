import type { RecordEvent } from '@dltech/atlas-core'

export type AgentState = {
  agentId: string
  agentType: string
  intent: string
  running: boolean
}

export const agentsOf = (args: {
  events: readonly RecordEvent[]
}): ReadonlyMap<string, AgentState> => {
  const agents = new Map<string, AgentState>()

  for (const event of args.events) {
    if (event.type === 'agent-spawned' || event.type === 'agent-restarted') {
      agents.set(event.agentId, {
        agentId: event.agentId,
        agentType: event.agentType,
        intent: event.intent,
        running: true,
      })
      continue
    }
    if (event.type !== 'agent-ended') continue
    const known = agents.get(event.agentId)
    agents.set(event.agentId, {
      agentId: event.agentId,
      agentType: known?.agentType ?? event.agentType,
      intent: known?.intent ?? event.intent,
      running: false,
    })
  }

  return agents
}

export const agentOf = (args: {
  events: readonly RecordEvent[]
  agentId: string
}): AgentState | undefined => agentsOf({ events: args.events }).get(args.agentId)

export const agentLabelOf = (agent: AgentState | undefined): string => {
  if (agent === undefined) return 'Sub-agent'
  if (agent.intent.trim().length > 0) return agent.intent
  if (agent.agentType.trim().length > 0) return agent.agentType
  return 'Sub-agent'
}
