import { describe, expect, it } from 'bun:test'

import { EAgentRestart, EAgentStatus, EKilledBy } from '@dltech/atlas-core'

import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, finished, openSupervisor, settled } from './fixtures'

const restartsIn = async (
  s: Awaited<ReturnType<typeof openSupervisor>>,
): Promise<readonly Extract<Awaited<ReturnType<typeof s.harness.log.readOwn>>[number], { type: 'agent-restarted' }>[]> => {
  const events = await s.harness.log.readOwn({ threadId: s.parent })
  return events.filter((event) => event.type === 'agent-restarted')
}

const spawnAndFinish = async (s: Awaited<ReturnType<typeof openSupervisor>>) => {
  const spawned = await s.supervisor.spawn({
    threadId: s.parent,
    agentType: 'explore',
    brief: 'wait on the suite',
    intent: 'wait',
  })
  expect(spawned.ok).toBe(true)
  if (!spawned.ok) return undefined

  s.runners.started[0]?.settle(finished())
  await settled()
  return spawned.snapshot.agentId
}

describe('recording a child restart in the parent log', () => {
  it('records an agent_resume restart, so the log says the child left its ending', async () => {
    const s = await openSupervisor()
    const agentId = await spawnAndFinish(s)
    if (agentId === undefined) return

    const resumed = await s.supervisor.resume({ agentId, threadId: s.parent })

    expect(resumed.ok).toBe(true)
    const restarts = await restartsIn(s)
    expect(restarts).toHaveLength(1)
    expect(restarts[0]).toMatchObject({ agentId, via: EAgentRestart.Resume })
    await s.close()
  })

  it('records a message restart when a stopped child is told something', async () => {
    const s = await openSupervisor()
    const agentId = await spawnAndFinish(s)
    if (agentId === undefined) return

    const said = await s.supervisor.say({ agentId, threadId: s.parent, text: 'keep going' })

    expect(said.ok).toBe(true)
    const restarts = await restartsIn(s)
    expect(restarts).toHaveLength(1)
    expect(restarts[0]).toMatchObject({ agentId, via: EAgentRestart.Message })
    await s.close()
  })

  it('records a wake restart when a queued notice restarts the child', async () => {
    const s = await openSupervisor()
    const agentId = await spawnAndFinish(s)
    if (agentId === undefined) return

    const woken = await s.supervisor.wake({ agentId })

    expect(woken.ok).toBe(true)
    const restarts = await restartsIn(s)
    expect(restarts).toHaveLength(1)
    expect(restarts[0]).toMatchObject({ agentId, via: EAgentRestart.Wake })
    await s.close()
  })

  it('records nothing for a spawn, which the spawn event already covers', async () => {
    const s = await openSupervisor()
    const spawned = await s.supervisor.spawn({
      threadId: s.parent,
      agentType: 'explore',
      brief: 'fresh work',
      intent: 'work',
    })

    expect(spawned.ok).toBe(true)
    expect(await restartsIn(s)).toHaveLength(0)
    await s.close()
  })

  it('reads a restart that the process did not survive as lost, not as the stale ending before it', async () => {
    const s = await openSupervisor()
    const agentId = await spawnAndFinish(s)
    if (agentId === undefined) return

    await s.supervisor.resume({ agentId, threadId: s.parent })

    const rebuilt = new AgentSupervisor({
      log: s.harness.log,
      threads: s.harness.threads,
      ids: s.harness.ids,
      clock: s.harness.clock,
      agentTypes: [agentTypeNamed({ name: 'explore' })],
      runners: s.runners.source,
      launchDirectory: '/launch',
    })
    await rebuilt.hydrate({ threadId: s.parent })
    const [child] = rebuilt.list({ threadId: s.parent })

    expect(child?.status).toBe(EAgentStatus.Stopped)
    expect(child?.endedAt).toBeUndefined()

    const lost = await rebuilt.recordLostAgents({ threadId: s.parent })
    expect(lost.settled).toHaveLength(1)
    expect(lost.settled[0]?.killedBy).toBe(EKilledBy.Unrecorded)
    await s.close()
  })
})
