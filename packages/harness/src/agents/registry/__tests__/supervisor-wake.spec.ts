import { describe, expect, it } from 'bun:test'

import { EKilledBy } from '@dltech/atlas-core'

import { ChildWake } from '../../../composition/child-wake'
import { agentTypeNamed, openSupervisor, settled, finished, interrupted } from './fixtures'

describe('a supervisor waking a stopped child', () => {
  it('restarts a child whose turn ended, so queued notices reach it', async () => {
    const s = await openSupervisor()
    const spawned = await s.supervisor.spawn({
      threadId: s.parent,
      agentType: 'explore',
      brief: 'wait on the suite',
      intent: 'wait',
    })
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return

    s.runners.started[0]?.settle(finished())
    await settled()

    const woken = await s.supervisor.wake({ agentId: spawned.snapshot.agentId })

    expect(woken.ok).toBe(true)
    expect(s.runners.started).toHaveLength(2)
    await s.close()
  })

  it('never restarts a child that is still stepping', async () => {
    const s = await openSupervisor()
    const spawned = await s.supervisor.spawn({
      threadId: s.parent,
      agentType: 'explore',
      brief: 'still working',
      intent: 'work',
    })
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return

    const woken = await s.supervisor.wake({ agentId: spawned.snapshot.agentId })

    expect(woken.ok).toBe(false)
    expect(s.runners.started).toHaveLength(1)
    await s.close()
  })

  it('never resurrects a deliberately stopped child', async () => {
    const s = await openSupervisor()
    const spawned = await s.supervisor.spawn({
      threadId: s.parent,
      agentType: 'explore',
      brief: 'will be stopped',
      intent: 'stop me',
    })
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return

    s.supervisor.stop({
      agentId: spawned.snapshot.agentId,
      threadId: s.parent,
      by: EKilledBy.User,
    })
    s.runners.started[0]?.settle(interrupted())
    await settled()

    const woken = await s.supervisor.wake({ agentId: spawned.snapshot.agentId })

    expect(woken.ok).toBe(false)
    expect(s.runners.started).toHaveLength(1)
    if (!woken.ok) expect(woken.reason).toContain('stopped')
    await s.close()
  })

  it('never wakes a thread that is not its child', async () => {
    const s = await openSupervisor()

    const woken = await s.supervisor.wake({ agentId: s.parent })

    expect(woken.ok).toBe(false)
    expect(s.runners.started).toHaveLength(0)
    await s.close()
  })

  it('wakes a stopped teammate when its own builder reports, through the notice queue', async () => {
    const s = await openSupervisor({
      agentTypes: [agentTypeNamed({ name: 'teammate' }), agentTypeNamed({ name: 'builder' })],
    })
    new ChildWake({ agents: s.supervisor, sources: [s.supervisor] })

    const teammate = await s.supervisor.spawn({
      threadId: s.parent,
      agentType: 'teammate',
      brief: 'coordinate',
      intent: 'coordinate',
    })
    expect(teammate.ok).toBe(true)
    if (!teammate.ok) return

    const builder = await s.supervisor.spawn({
      threadId: teammate.snapshot.agentId,
      agentType: 'builder',
      brief: 'build a slice',
      intent: 'build',
    })
    expect(builder.ok).toBe(true)
    if (!builder.ok) return

    s.runners.started[0]?.settle(finished())
    await settled()
    expect(s.runners.started).toHaveLength(2)

    s.runners.started[1]?.settle(finished())
    await settled()

    expect(s.runners.started).toHaveLength(3)
    expect(s.runners.started[2]?.threadId).toBe(teammate.snapshot.agentId)
    await s.close()
  })
})
