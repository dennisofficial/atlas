import { describe, expect, it } from 'bun:test'
import { EAgentStatus, type ThreadId } from '@dltech/atlas-core'

import { ETurnStatus } from '../../../loop/turn-outcome'
import type { AgentOutcome } from '../port'
import { AgentSupervisor } from '../supervisor'
import { finished, openSupervisor, settled, type OpenedSupervisor } from './fixtures'

const gate = () => {
  let open = (): void => undefined
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

const paused = () => ({ status: ETurnStatus.RelocationPaused as const, runId: finished().runId })

const spawn = async (entry: OpenedSupervisor): Promise<ThreadId> => {
  const spawned = await entry.supervisor.spawn({
    threadId: entry.parent, agentType: 'explore', brief: 'look around', intent: 'a look around',
  })
  if (!spawned.ok) throw new Error(spawned.reason)
  await settled()
  entry.runners.started[0]?.settle(paused())
  await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
  return spawned.snapshot.agentId
}

type Restart = {
  name: string
  start: (args: { entry: OpenedSupervisor; agentId: ThreadId }) => Promise<AgentOutcome>
}

const restarts: Restart[] = [
  { name: 'notice wake', start: ({ entry, agentId }) => entry.supervisor.wake({ agentId }) },
  { name: 'explicit resume', start: ({ entry, agentId }) => entry.supervisor.resume({ agentId, threadId: entry.parent }) },
  { name: 'explicit say', start: ({ entry, agentId }) => entry.supervisor.say({ agentId, threadId: entry.parent, text: 'continue' }) },
]

describe('family pause includes admitted child work', () => {
  for (const restart of restarts) {
    it(`waits for ${restart.name} persistence and its resulting child seam`, async () => {
      const entry = await openSupervisor()
      try {
        const agentId = await spawn(entry)
        const append = entry.harness.log.append.bind(entry.harness.log)
        const entered = gate()
        const written = gate()
        entry.harness.log.append = async (args) => {
          if (args.drafts.some((draft) => draft.type === 'agent-restarted')) {
            entered.open()
            await written.promise
          }
          return append(args)
        }
        const restarting = restart.start({ entry, agentId })
        await entered.promise
        expect(entry.supervisor.settling()).toBe(true)
        const pausing = entry.supervisor.pauseChildren({ threadId: entry.parent })
        let confirmed = false
        void pausing.then(() => { confirmed = true })
        await Bun.sleep(1)
        expect(confirmed).toBe(false)
        expect(entry.runners.started).toHaveLength(1)
        written.open()
        expect((await restarting).ok).toBe(true)
        await Bun.sleep(1)
        expect(confirmed).toBe(false)
        expect(entry.runners.started).toHaveLength(2)
        entry.runners.started[1]?.settle(paused())
        expect(await pausing).toEqual([agentId])
        expect(entry.supervisor.list({ threadId: entry.parent })[0]?.status).toBe(EAgentStatus.Paused)
        expect(entry.supervisor.settling()).toBe(false)
        const events = await entry.harness.log.readOwn({ threadId: entry.parent })
        expect(events.findLast((event) => event.type === 'agent-ended' && event.agentId === agentId))
          .toMatchObject({ status: EAgentStatus.Paused })
        await Bun.sleep(1)
        expect(entry.runners.started).toHaveLength(2)
      } finally {
        await entry.close()
      }
    })
  }

  it('waits for an admitted spawn before taking the family pause snapshot', async () => {
    const entry = await openSupervisor()
    try {
      const entered = gate()
      const admitted = gate()
      const supervisor = new AgentSupervisor({
        log: entry.harness.log, threads: entry.harness.threads, ids: entry.harness.ids,
        clock: entry.harness.clock, runners: entry.runners.source,
        agentTypes: entry.supervisor.types(), launchDirectory: '/launch',
        modelAtSpawn: async () => { entered.open(); await admitted.promise; return undefined },
      })
      const spawning = supervisor.spawn({
        threadId: entry.parent, agentType: 'explore', brief: 'look around', intent: 'a look around',
      })
      await entered.promise
      const pausing = supervisor.pauseChildren({ threadId: entry.parent })
      let confirmed = false
      void pausing.then(() => { confirmed = true })
      await Bun.sleep(1)
      expect(confirmed).toBe(false)
      admitted.open()
      const spawned = await spawning
      if (!spawned.ok) throw new Error(spawned.reason)
      await Bun.sleep(1)
      expect(confirmed).toBe(false)
      entry.runners.started[0]?.settle(paused())
      expect(await pausing).toEqual([spawned.snapshot.agentId])
    } finally {
      await entry.close()
    }
  })

  it('rejects preparation when an admitted restart append fails', async () => {
    const entry = await openSupervisor()
    try {
      const agentId = await spawn(entry)
      const append = entry.harness.log.append.bind(entry.harness.log)
      const entered = gate()
      const written = gate()
      entry.harness.log.append = async (args) => {
        if (args.drafts.some((draft) => draft.type === 'agent-restarted')) {
          entered.open()
          await written.promise
          throw new Error('restart append failed')
        }
        return append(args)
      }
      const restarting = entry.supervisor.wake({ agentId })
      await entered.promise
      const pausing = entry.supervisor.pauseChildren({ threadId: entry.parent })
      const restartFailed = restarting.then(() => null, (error: unknown) => error)
      const pauseFailed = pausing.then(() => null, (error: unknown) => error)
      written.open()
      expect(await restartFailed).toMatchObject({ message: 'restart append failed' })
      expect(await pauseFailed).toMatchObject({ message: 'restart append failed' })
      expect(entry.runners.started).toHaveLength(1)
    } finally {
      await entry.close()
    }
  })

  it('still permits an owed notice wake of a naturally finished child', async () => {
    const entry = await openSupervisor()
    try {
      const spawned = await entry.supervisor.spawn({
        threadId: entry.parent, agentType: 'explore', brief: 'look around', intent: 'a look around',
      })
      if (!spawned.ok) throw new Error(spawned.reason)
      await settled()
      entry.runners.started[0]?.settle(finished())
      await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
      expect((await entry.supervisor.wake({ agentId: spawned.snapshot.agentId })).ok).toBe(true)
      entry.runners.started[1]?.settle(paused())
      await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
      expect(entry.runners.started).toHaveLength(2)
    } finally {
      await entry.close()
    }
  })
})
