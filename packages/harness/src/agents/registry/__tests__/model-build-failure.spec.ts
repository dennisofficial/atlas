import { expect, it } from 'bun:test'
import { EAgentStatus } from '@dltech/atlas-core'

import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, loggedOfType, openSupervisor } from './fixtures'

it('reports the reason when a saved child model cannot build a runner', async () => {
  const opened = await openSupervisor()
  const { harness, parent } = opened
  try {
    const supervisor = new AgentSupervisor({
      log: harness.log,
      threads: harness.threads,
      ids: harness.ids,
      clock: harness.clock,
      agentTypes: [agentTypeNamed({ name: 'explore' })],
      launchDirectory: '/launch',
      runners: async () => { throw new Error('no provider adapter can answer for inference/kimi-k3-fast') },
    })
    const child = await supervisor.spawn({
      threadId: parent,
      agentType: 'explore',
      brief: 'audit',
      intent: 'audit',
    })
    expect(child.ok).toBe(true)
    await supervisor.whenChildrenSettled({ threadId: parent })
    expect(supervisor.list({ threadId: parent })[0]?.status).toBe(EAgentStatus.Failed)
    const [ending] = await loggedOfType({ harness, threadId: parent, type: 'agent-ended' })
    expect(ending?.prose ?? '').toContain('inference/kimi-k3-fast')
  } finally {
    await opened.close()
  }
})
