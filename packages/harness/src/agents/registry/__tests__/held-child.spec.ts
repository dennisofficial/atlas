import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import {
  agentTypeNamed,
  failed,
  finished,
  loggedOfType,
  openSupervisor,
  settled,
  type OpenedSupervisor,
} from './fixtures'

const SHELL = 'bash "bun test"'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

async function openHolding() {
  const holding = new Map<ThreadId, string>()
  const killed: { threadId: ThreadId; by: EKilledBy; endedBefore: number }[] = []
  const entry = await openSupervisor({
    agentTypes: [
      agentTypeNamed({ name: 'builder' }),
      agentTypeNamed({ name: TEAMMATE_AGENT_TYPE }),
    ],
    runningShell: (threadId) => holding.get(threadId),
    endShells: async ({ threadId, by }) => {
      killed.push({ threadId, by, endedBefore: ended(entry).length })
      holding.delete(threadId)
    },
  })
  opened.push(entry)
  return { entry, holding, killed }
}

const ended = (entry: OpenedSupervisor) =>
  entry.supervisor.list({ threadId: entry.parent }).filter((one) => one.endedAt !== undefined)

async function spawn(entry: OpenedSupervisor, agentType: string): Promise<ThreadId> {
  const outcome = await entry.supervisor.spawn({
    threadId: entry.parent,
    agentType,
    brief: 'do the work',
    intent: 'the work',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  await settled()
  return outcome.snapshot.agentId
}

const snapshotOf = (entry: OpenedSupervisor, agentId: ThreadId) =>
  entry.supervisor.list({ threadId: entry.parent }).find((one) => one.agentId === agentId)

describe('a sub-agent that ends its turn owning a running shell', () => {
  it('is held: still running, idle, naming the shell, and nothing recorded or woken', async () => {
    const { entry, holding } = await openHolding()
    const agentId = await spawn(entry, 'builder')

    holding.set(agentId, SHELL)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const held = snapshotOf(entry, agentId)
    expect(held?.status).toBe(EAgentStatus.Running)
    expect(held?.steppingSince).toBeUndefined()
    expect(held?.waitingOn).toBe(SHELL)
    expect(held?.endedAt).toBeUndefined()
    expect(
      await loggedOfType({ harness: entry.harness, threadId: entry.parent, type: 'agent-ended' }),
    ).toHaveLength(0)
    expect(entry.supervisor.threadsAwaitingNotice()).toEqual([])
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(false)
  })

  it('steps again when woken, then ends once and wakes its parent', async () => {
    const { entry, holding } = await openHolding()
    const agentId = await spawn(entry, 'builder')

    holding.set(agentId, SHELL)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    holding.delete(agentId)
    expect((await entry.supervisor.wake({ agentId })).ok).toBe(true)
    expect(entry.runners.started).toHaveLength(2)
    expect(snapshotOf(entry, agentId)?.waitingOn).toBeUndefined()

    entry.runners.started[1]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const ended = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(ended).toHaveLength(1)
    expect(ended[0]?.relayed).toBeUndefined()
    expect(ended[0]?.status).toBe(EAgentStatus.Finished)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(true)
  })

  it('restarts on a message from its parent instead of queueing it behind a step that is not running', async () => {
    const { entry, holding } = await openHolding()
    const agentId = await spawn(entry, 'builder')
    holding.set(agentId, SHELL)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const said = await entry.supervisor.say({ agentId, threadId: entry.parent, text: 'status?' })

    expect(said.ok).toBe(true)
    expect(entry.runners.started).toHaveLength(2)
  })

  it('ends with a Stopped ending the parent hears when agent_stop settles it', async () => {
    const { entry, holding, killed } = await openHolding()
    const agentId = await spawn(entry, 'builder')
    holding.set(agentId, SHELL)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const stopped = await entry.supervisor.stop({
      agentId,
      threadId: entry.parent,
      by: EKilledBy.Model,
    })
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(stopped.ok).toBe(true)
    const ended = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(ended.map((one) => [one.status, one.killedBy])).toEqual([
      [EAgentStatus.Stopped, EKilledBy.Model],
    ])
    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.Stopped)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(true)
    expect(killed).toEqual([{ threadId: agentId, by: EKilledBy.Model, endedBefore: 0 }])
  })

  it('is settled when the session closes, so a clean quit leaves no spawn without an ending', async () => {
    const { entry, holding, killed } = await openHolding()
    const agentId = await spawn(entry, 'builder')
    holding.set(agentId, SHELL)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    await entry.supervisor.closeAll()
    expect(killed).toEqual([{ threadId: agentId, by: EKilledBy.SessionEnd, endedBefore: 0 }])

    const ended = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(ended.map((one) => [one.status, one.killedBy])).toEqual([
      [EAgentStatus.Stopped, EKilledBy.SessionEnd],
    ])
  })

  it('still ends when its turn failed, whatever it owns', async () => {
    const { entry, holding } = await openHolding()
    const agentId = await spawn(entry, 'builder')

    holding.set(agentId, SHELL)
    entry.runners.started[0]?.settle(failed('the model errored'))
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.Failed)
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(true)
  })
})

describe('a sub-agent that ends its turn owning no shell', () => {
  it('ends at once and wakes its parent, whatever else it left running', async () => {
    const { entry } = await openHolding()
    const agentId = await spawn(entry, 'builder')

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.Finished)
    expect(snapshotOf(entry, agentId)?.waitingOn).toBeUndefined()
    expect(entry.supervisor.threadsAwaitingNotice()).toEqual([entry.parent])
  })
})

describe('a sub-agent that ends its turn leaving a service running', () => {
  it('records the service on its ending so the parent, who owns it now, hears of it', async () => {
    const entry = await openSupervisor({
      agentTypes: [agentTypeNamed({ name: 'builder' })],
      leftServices: () => ['dev server'],
    })
    opened.push(entry)
    await spawn(entry, 'builder')

    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const ended = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(ended.map((one) => one.leftServices)).toEqual([['dev server']])
  })
})

describe('a teammate, which speaks by report', () => {
  it('is never held: it records a bookkeeping ending that does not wake', async () => {
    const { entry, holding } = await openHolding()
    const agentId = await spawn(entry, TEAMMATE_AGENT_TYPE)

    holding.set(agentId, SHELL)
    entry.runners.started[0]?.settle(finished())
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const ended = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(ended.map((one) => [one.status, one.relayed])).toEqual([[EAgentStatus.Finished, false]])
    expect(snapshotOf(entry, agentId)?.status).toBe(EAgentStatus.Finished)
    expect(entry.supervisor.threadsAwaitingNotice()).toEqual([])
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(false)
  })

  it('wakes its parent when it fails, so a crashed teammate is never silent', async () => {
    const { entry } = await openHolding()
    await spawn(entry, TEAMMATE_AGENT_TYPE)

    entry.runners.started[0]?.settle(failed('the session crashed'))
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    const ended = await loggedOfType({
      harness: entry.harness,
      threadId: entry.parent,
      type: 'agent-ended',
    })
    expect(ended.map((one) => [one.status, one.relayed])).toEqual([
      [EAgentStatus.Failed, undefined],
    ])
    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(true)
  })

  it('wakes its parent when it is stopped', async () => {
    const { entry } = await openHolding()
    const agentId = await spawn(entry, TEAMMATE_AGENT_TYPE)

    await entry.supervisor.stop({ agentId, threadId: entry.parent, by: EKilledBy.Model })
    entry.runners.started[0]?.settle({ ...finished(), status: 'interrupted' as never })
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })

    expect(entry.supervisor.prepareNotifications({ threadId: entry.parent }).wakesTurn).toBe(true)
  })
})
