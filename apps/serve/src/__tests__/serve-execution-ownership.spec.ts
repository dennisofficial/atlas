import { describe, expect, it } from 'bun:test'
import { EAgentStatus, EKilledBy, EShellStatus, EServiceStatus } from '@dltech/atlas-core'
import { EClientFrame, EServeFrame, toSendId } from '@dltech/atlas-harness'

import { OWNERSHIP_AGENT_TYPE, OWNERSHIP_THREAD, OWNERSHIP_TOKEN, startOwnershipServe } from './serve-execution-ownership-fixture'
import { connect, type TestClient } from './client'

const gate = () => {
  let open = (): void => undefined
  const done = new Promise<void>((resolve) => { open = resolve })
  return { done, open }
}

const hello = async (client: TestClient): Promise<void> => {
  client.send({ kind: EClientFrame.Hello, threadId: OWNERSHIP_THREAD, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
}

const familyCalls = [
  { callId: 'spawn-child', name: 'agent_spawn', input: { agentType: OWNERSHIP_AGENT_TYPE.name, intent: 'held child', brief: 'finish child work' } },
]

describe('serve owns execution independently of its actual socket clients', () => {
  it('keeps a main turn, child, shell and service alive across client close and reconnect', async () => {
    const parent = gate()
    const child = gate()
    const entered = gate()
    const world = await startOwnershipServe({
      main: [{ calls: familyCalls }, { text: 'parent finished', hold: parent.done, entered: entered.open }, { text: 'received endings' }],
      child: [{ text: 'child finished', hold: child.done }],
    })
    try {
      const first = await connect({ port: world.handle.port, token: OWNERSHIP_TOKEN })
      await hello(first)
      first.send({ kind: EClientFrame.Send, sendId: toSendId('owned-send'), text: 'start work' })
      await entered.done
      const startedShell = await world.shells.start({ threadId: OWNERSHIP_THREAD, command: 'sleep 600', description: 'held shell' })
      if (!startedShell.ok) throw new Error(startedShell.reason)
      const startedService = await world.services.start({ threadId: OWNERSHIP_THREAD, command: 'sleep 600', description: 'held service' })
      if (!startedService.ok) throw new Error(startedService.reason)
      const spawned = world.agents.listEverywhere()[0]
      const shell = world.shells.listEverywhere()[0]
      const service = world.services.list()[0]
      if (spawned === undefined || shell === undefined || service === undefined) throw new Error('family did not start')
      first.close()
      await first.closed
      const second = await connect({ port: world.handle.port, token: OWNERSHIP_TOKEN })
      await hello(second)
      const ready = second.frames.find((frame) => frame.kind === EServeFrame.Ready)
      expect(ready?.turnInFlight).toBe(true)
      expect(world.agents.listEverywhere()[0]?.status).toBe(EAgentStatus.Running)
      expect(world.shells.listEverywhere()[0]?.status).toBe(EShellStatus.Running)
      expect(world.services.list()[0]?.status).toBe(EServiceStatus.Running)
      expect(world.agents.listEverywhere()[0]?.killedBy).toBeUndefined()
      expect(world.shells.listEverywhere()[0]?.killedBy).toBeUndefined()
      child.open()
      await world.agents.whenChildrenSettled({ threadId: OWNERSHIP_THREAD })
      world.shells.kill({ threadId: OWNERSHIP_THREAD, shellId: shell.shellId, by: EKilledBy.User })
      await world.shells.awaitEndings({ threadId: OWNERSHIP_THREAD, ms: 2_000 })
      parent.open()
      await second.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
      const events = await world.app.log.read({ threadId: OWNERSHIP_THREAD })
      const endedChild = events.find((event) => event.type === 'agent-ended')
      const endedShell = events.find((event) => event.type === 'background-shell-ended')
      expect(endedChild?.status).toBe(EAgentStatus.Finished)
      expect(endedChild?.killedBy).toBeUndefined()
      expect(endedShell?.killedBy).toBe(EKilledBy.User)
      second.close()
    } finally {
      parent.open()
      child.open()
      await world.handle.close()
    }
  }, 20_000)

  it('actual owner shutdown still kills and records the entire live family as SessionEnd', async () => {
    const world = await startOwnershipServe({
      main: [{ calls: familyCalls }, { text: 'family running' }],
      child: [{ text: 'never finish', hold: new Promise<void>(() => undefined) }],
    })
    const client = await connect({ port: world.handle.port, token: OWNERSHIP_TOKEN })
    try {
      await hello(client)
      client.send({ kind: EClientFrame.Send, sendId: toSendId('shutdown-send'), text: 'start work' })
      await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
      const startedShell = await world.shells.start({ threadId: OWNERSHIP_THREAD, command: 'sleep 600', description: 'held shell' })
      if (!startedShell.ok) throw new Error(startedShell.reason)
      const startedService = await world.services.start({ threadId: OWNERSHIP_THREAD, command: 'sleep 600', description: 'held service' })
      if (!startedService.ok) throw new Error(startedService.reason)
      await world.handle.close({ reason: 'actual-sandbox-shutdown' })
      const events = await world.app.log.read({ threadId: OWNERSHIP_THREAD })
      expect(events.find((event) => event.type === 'agent-ended')?.killedBy).toBe(EKilledBy.SessionEnd)
      expect(events.find((event) => event.type === 'background-shell-ended')?.killedBy).toBe(EKilledBy.SessionEnd)
      expect(events.find((event) => event.type === 'service-ended')?.killedBy).toBe(EKilledBy.SessionEnd)
    } finally {
      client.close()
      await world.handle.close()
    }
  }, 20_000)

  it('does not park while a dynamically spawned child is running after its parent turn ends', async () => {
    const child = gate()
    const checked = gate()
    const exits: number[] = []
    const world = await startOwnershipServe({
      main: [{ calls: [familyCalls[0]].filter((call) => call !== undefined) }, { text: 'parent idle' }],
      child: [{ text: 'child finished', hold: child.done }],
      idleMinutes: 0,
      idleTickMs: 5,
      exit: (code) => { exits.push(code) },
    })
    const client = await connect({ port: world.handle.port, token: OWNERSHIP_TOKEN })
    try {
      await hello(client)
      client.send({ kind: EClientFrame.Send, sendId: toSendId('idle-send'), text: 'spawn child' })
      await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
      setTimeout(checked.open, 60)
      await checked.done
      expect(exits).toEqual([])
      expect(world.agents.listEverywhere()[0]?.status).toBe(EAgentStatus.Running)
    } finally {
      child.open()
      client.close()
      await world.handle.close()
    }
  }, 20_000)
})
