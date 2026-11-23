import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '@dltech/atlas-core'
import type { SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

import { childPortOf } from '../child-port'

const snapshot: SubagentSnapshot = {
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'trace the port',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  startedAt: '2026-11-09T10:00:00.000Z',
}

describe('the crew port a sub-agent gets', () => {
  it('reaches a sibling through the room, and says nothing when no sub-agent has the id', async () => {
    const said: { agentId: string; text: string }[] = []
    const port = childPortOf({
      say: async (args) => {
        said.push(args)
        return args.agentId === 'a2' ? { queued: true, snapshot } : undefined
      },
      report: async () => snapshot,
    })

    expect(await port.say({ agentId: 'a2', text: 'take the parser' })).toMatchObject({
      queued: true,
    })
    expect(await port.say({ agentId: 'nope', text: 'hello' })).toBeUndefined()
    expect(said).toEqual([
      { agentId: 'a2', text: 'take the parser' },
      { agentId: 'nope', text: 'hello' },
    ])
  })

  it('reports to its parent', async () => {
    const reported: string[] = []
    const port = childPortOf({
      say: async () => undefined,
      report: async ({ text }) => {
        reported.push(text)
        return snapshot
      },
    })

    await port.report({ text: 'done reading' })
    expect(reported).toEqual(['done reading'])
  })

  it('refuses to spawn or stop sub-agents of its own', async () => {
    const port = childPortOf({ say: async () => undefined, report: async () => snapshot })

    await expect(
      port.spawn({ agentType: 'general-purpose', intent: 'trace', prompt: 'go' }),
    ).rejects.toThrow('a sub-agent cannot spawn sub-agents')
    await expect(port.stop({ agentId: 'a2' })).rejects.toThrow(
      'a sub-agent cannot stop other agents',
    )
    expect(port.list()).toEqual([])
  })
})
