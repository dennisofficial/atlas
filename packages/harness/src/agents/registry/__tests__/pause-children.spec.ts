import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { buildHarness, type AtlasHarness } from '../../../loop/build-harness'
import { createTempHome } from '../../../loop/__tests__/temp-home'
import { ETurnStatus, type TurnOutcome } from '../../../loop/turn-outcome'
import type { PauseSignal } from '../../../loop/pause-signal'
import { scriptedModel } from '../../../model/testing/scripted-model'
import type { ChildRunnerSource } from '../child-runner'
import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, finished, openSupervisor, settled } from './fixtures'

const interrupted = (): TurnOutcome => ({
  status: ETurnStatus.Interrupted,
  runId: 'run-interrupted' as never,
  committed: false,
})

const relocationPaused = (): TurnOutcome => ({
  status: ETurnStatus.RelocationPaused,
  runId: 'run-paused' as never,
})

const pauseAwareRunners = (): ChildRunnerSource => {
  const hold = (args: {
    signal: AbortSignal | undefined
    pause: PauseSignal | undefined
  }): Promise<TurnOutcome> =>
    new Promise<TurnOutcome>((resolve) => {
      args.signal?.addEventListener('abort', () => resolve(interrupted()))
      const pause = args.pause
      if (pause === undefined) return
      const poll = () => {
        if (pause.paused) {
          resolve(relocationPaused())
          return
        }
        if (args.signal?.aborted) return
        setTimeout(poll, 1)
      }
      poll()
    })

  return () => ({
    say: ({ signal, pause }) => hold({ signal, pause }),
    runTurn: ({ signal, pause }) => hold({ signal, pause }),
    resume: ({ signal, pause }) => hold({ signal, pause }),
  })
}

type Opened = {
  harness: AtlasHarness
  supervisor: AgentSupervisor
  parent: ThreadId
  close: () => Promise<void>
}

const open = async (): Promise<Opened> => {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [] }),
  })
  const parent = (await harness.threads.create({})).id
  const supervisor = new AgentSupervisor({
    log: harness.log,
    threads: harness.threads,
    ids: harness.ids,
    clock: harness.clock,
    agentTypes: [agentTypeNamed({ name: 'explore' }), agentTypeNamed({ name: 'teammate' })],
    runners: pauseAwareRunners(),
    launchDirectory: '/launch',
  })
  await supervisor.hydrate({ threadId: parent })

  return {
    harness,
    supervisor,
    parent,
    close: async () => {
      await harness.close()
      temp.discard()
    },
  }
}

const opened: Opened[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const spawn = async (args: {
  entry: Opened
  threadId: ThreadId
  agentType: string
}): Promise<ThreadId> => {
  const outcome = await args.entry.supervisor.spawn({
    threadId: args.threadId,
    agentType: args.agentType,
    brief: 'look around',
    intent: 'a look around',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  await settled()
  return outcome.snapshot.agentId
}

const snapshotOf = (entry: Opened, agentId: ThreadId) =>
  entry.supervisor.list({ threadId: entry.parent }).find((one) => one.agentId === agentId)

describe('pausing a stepping child', () => {
  it('relocates a descendant that failed while an ancestor was reaching its seam — its ending is logged, not a blocker', async () => {
    const entry = await openSupervisor()
    opened.push(entry)
    const child = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    const pausing = entry.supervisor.pauseChildren({ threadId: entry.parent })
    await Bun.sleep(1)
    const descendant = await spawn({ entry, threadId: child, agentType: 'explore' })
    entry.runners.started[1]?.fail(new Error('late descendant failed'))
    entry.runners.started[0]?.settle(relocationPaused())
    const paused = await pausing
    expect(paused).toEqual([child])
    const events = await entry.harness.log.readOwn({ threadId: child })
    expect(events.some((event) => event.type === 'agent-ended' && event.agentId === descendant && event.status === EAgentStatus.Failed)).toBe(true)
  })

  it('pauses descendants and persists each outcome in the actual parent log', async () => {
    const entry = await open()
    opened.push(entry)
    const child = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    const grandchild = await spawn({ entry, threadId: child, agentType: 'explore' })
    const paused = await entry.supervisor.pauseChildren({ threadId: entry.parent })
    expect(paused).toEqual(expect.arrayContaining([child, grandchild]))
    expect(paused).toHaveLength(2)
    for (const [owner, agentId] of [[entry.parent, child], [child, grandchild]] as const) {
      const events = await entry.harness.log.readOwn({ threadId: owner })
      expect(events.filter((event) => event.type === 'agent-ended' && event.agentId === agentId))
        .toEqual([expect.objectContaining({ status: EAgentStatus.Paused, killedBy: undefined })])
    }
  })

  it('pauses past a failed child only after its siblings stop writing', async () => {
    const entry = await openSupervisor()
    opened.push(entry)
    const first = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    const sibling = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    const pausing = entry.supervisor.pauseChildren({ threadId: entry.parent })
    let ended = false
    void pausing.then(() => { ended = true }, () => { ended = true })
    entry.runners.started[0]?.fail(new Error('child model failed'))
    await Bun.sleep(1)
    expect(ended).toBe(false)
    entry.runners.started[1]?.settle(relocationPaused())
    const paused = await pausing
    expect(ended).toBe(true)
    expect(paused).toEqual([sibling])
    const events = await entry.harness.log.readOwn({ threadId: entry.parent })
    expect(events.some((event) => event.type === 'agent-ended' && event.agentId === first && event.status === EAgentStatus.Failed)).toBe(true)
  })

  it('keeps a terminal ending whose first append failed so the pause flush persists it', async () => {
    const entry = await openSupervisor()
    opened.push(entry)
    const child = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    const append = entry.harness.log.append.bind(entry.harness.log)
    let fail = true
    entry.harness.log.append = async (args) => {
      if (fail && args.drafts.some((draft) => draft.type === 'agent-ended')) {
        fail = false
        throw new Error('ending storage unavailable')
      }
      return append(args)
    }
    const pausing = entry.supervisor.pauseChildren({ threadId: entry.parent })
    entry.runners.started[0]?.settle(finished())
    await pausing
    await entry.supervisor.pauseChildren({ threadId: entry.parent })
    const events = await entry.harness.log.readOwn({ threadId: entry.parent })
    expect(events.filter((event) => event.type === 'agent-ended' && event.agentId === child))
      .toEqual([expect.objectContaining({ status: EAgentStatus.Finished })])
  })

  it('returns already-paused descendants after a failed persistence attempt', async () => {
    const entry = await open()
    opened.push(entry)
    const child = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    const append = entry.harness.log.append.bind(entry.harness.log)
    let fail = true
    entry.harness.log.append = async (args) => {
      if (fail && args.drafts.some((draft) => draft.type === 'agent-ended')) {
        fail = false
        throw new Error('pause storage unavailable')
      }
      return append(args)
    }
    await expect(entry.supervisor.pauseChildren({ threadId: entry.parent })).rejects.toThrow('pause storage unavailable')
    expect(await entry.supervisor.pauseChildren({ threadId: entry.parent })).toEqual([child])
    const events = await entry.harness.log.readOwn({ threadId: entry.parent })
    expect(events.filter((event) => event.type === 'agent-ended' && event.agentId === child))
      .toEqual([expect.objectContaining({ status: EAgentStatus.Paused })])
  })

  it('waits for the halt at the seam without attributing a stop', async () => {
    const entry = await open()
    opened.push(entry)
    const childId = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })

    const paused = await entry.supervisor.pauseChildren({ threadId: entry.parent })

    expect(paused).toEqual([childId])
    const snapshot = snapshotOf(entry, childId)
    expect(snapshot?.status).toBe(EAgentStatus.Paused)
    expect(snapshot?.killedBy).toBeUndefined()
  })

  it('pauses teammates too — a relocation moves everything', async () => {
    const entry = await open()
    opened.push(entry)
    const childId = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    const teammateId = await spawn({ entry, threadId: entry.parent, agentType: 'teammate' })

    const paused = await entry.supervisor.pauseChildren({ threadId: entry.parent })

    expect(paused).toEqual(expect.arrayContaining([childId, teammateId]))
    expect(paused).toHaveLength(2)
    expect(snapshotOf(entry, teammateId)?.killedBy).toBeUndefined()
  })

  it('leaves an already-settled child out of the pause', async () => {
    const entry = await open()
    opened.push(entry)
    const settledId = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    await entry.supervisor.stop({ agentId: settledId, threadId: entry.parent, by: EKilledBy.User })
    await entry.supervisor.whenChildrenSettled({ threadId: entry.parent })
    const steppingId = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })

    const paused = await entry.supervisor.pauseChildren({ threadId: entry.parent })

    expect(paused).toEqual([steppingId])
    expect(snapshotOf(entry, settledId)?.killedBy).toBe(EKilledBy.User)
  })

  it("leaves another thread's children alone", async () => {
    const entry = await open()
    opened.push(entry)
    const otherParent = (await entry.harness.threads.create({})).id
    const mine = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })
    await spawn({ entry, threadId: otherParent, agentType: 'explore' })

    const paused = await entry.supervisor.pauseChildren({ threadId: entry.parent })

    expect(paused).toEqual([mine])
  })

  it('resumes cleanly afterward, since nothing about the child was torn down', async () => {
    const entry = await open()
    opened.push(entry)
    const childId = await spawn({ entry, threadId: entry.parent, agentType: 'explore' })

    await entry.supervisor.pauseChildren({ threadId: entry.parent })
    const resumed = await entry.supervisor.resume({ agentId: childId, threadId: entry.parent })

    expect(resumed.ok).toBe(true)
    expect(snapshotOf(entry, childId)?.status).toBe(EAgentStatus.Running)
  })

  it('lands an ending that arrives while the children settle, so the far side sees the child end', async () => {
    const entry = await openSupervisor()
    const spawned = await entry.supervisor.spawn({
      threadId: entry.parent,
      agentType: 'explore',
      brief: 'look around',
      intent: 'a look around',
    })
    if (!spawned.ok) throw new Error(spawned.reason)
    const childId = spawned.snapshot.agentId
    await settled()

    const pausing = entry.supervisor.pauseChildren({ threadId: entry.parent })
    entry.runners.started.at(-1)?.settle(finished())
    await pausing

    const events = await entry.harness.log.readOwn({ threadId: entry.parent })
    const endings = events.filter(
      (event) => event.type === 'agent-ended' && event.agentId === childId,
    )
    expect(endings).toHaveLength(1)
    expect(endings[0]).toMatchObject({ status: EAgentStatus.Finished, killedBy: undefined })

    await entry.close()
  })
})
