import { agentOutcomeWireSchema, EAgentStatus, EClientRequest, type AgentSnapshotWire } from '@dltech/atlas-wire'
import type { Event, ThreadId } from '@dltech/atlas-core'

import type { CloudChannel } from '../src/index'

const TURN_TIMEOUT_MS = 120000

function awaitAgentTurn(args: { channel: CloudChannel; agentId: ThreadId }) {
  let off: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = new Promise<AgentSnapshotWire>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`teammate ${args.agentId} never settled its resumed turn`)), TURN_TIMEOUT_MS)
    off = args.channel.onRoster((roster) => {
      const agent = roster.agents.find((candidate) => candidate.agentId === args.agentId)
      if (agent === undefined) return
      if (agent.status === EAgentStatus.Failed) reject(new Error(`teammate ${args.agentId} failed: ${agent.failureCause ?? 'no cause recorded'}`))
      else if (agent.status !== EAgentStatus.Running && agent.toolCalls >= 1) resolve(agent)
    })
  })
  const stop = (): void => {
    off?.()
    clearTimeout(timer)
  }
  return { settled: settled.finally(stop), stop }
}

export async function steerSettledTeammate(args: { channel: CloudChannel; rootId: ThreadId; agentId: ThreadId; text: string }): Promise<AgentSnapshotWire> {
  const turn = awaitAgentTurn({ channel: args.channel, agentId: args.agentId })
  turn.settled.catch(() => undefined)
  const reply = agentOutcomeWireSchema.parse(await args.channel.request({
    op: EClientRequest.SayToAgent,
    params: { threadId: args.rootId, agentId: args.agentId, text: args.text },
  }))
  if (!reply.ok) {
    turn.stop()
    throw new Error(`the cloud refused to steer ${args.agentId}: ${reply.reason}`)
  }
  return turn.settled
}

export function lastBashOutput(args: { events: readonly Event[]; before: ReadonlySet<string> }): string | undefined {
  const result = args.events.findLast((event) => event.type === 'tool-result' && event.name === 'bash' && !args.before.has(event.id))
  return result?.type === 'tool-result' ? JSON.stringify(result.output) : undefined
}
