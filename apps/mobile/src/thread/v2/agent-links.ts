import type { V2Event } from '@dltech/atlas-core'
import { z } from 'zod'

export type AgentLinks = {
  byEventId: ReadonlyMap<string, string>
  byCallId: ReadonlyMap<string, string>
}

const SPAWN_TOOL = 'agent_spawn'

const spawnOutputSchema = z.object({ agentId: z.string().min(1) })

export const agentIdOfToolOutput = (output: unknown): string | undefined => {
  const parsed = spawnOutputSchema.safeParse(output)
  return parsed.success ? parsed.data.agentId : undefined
}

export const agentIdOfSpawnCall = (call: { name: string; output: unknown }): string | undefined =>
  call.name === SPAWN_TOOL ? agentIdOfToolOutput(call.output) : undefined

export const agentLinksOf = (args: { events: readonly V2Event[] }): AgentLinks => {
  const byEventId = new Map<string, string>()
  const byCallId = new Map<string, string>()

  for (const event of args.events) {
    if (event.type === 'agent-ended' || event.type === 'agent-reported') {
      byEventId.set(event.id, event.agentId)
      continue
    }
    if (event.type !== 'tool-result' || event.name !== SPAWN_TOOL) continue
    const agentId = agentIdOfToolOutput(event.output)
    if (agentId !== undefined) byCallId.set(event.callId, agentId)
  }

  return { byEventId, byCallId }
}
