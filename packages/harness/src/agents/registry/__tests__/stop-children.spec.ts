import { afterEach, describe, expect, it } from 'bun:test'

import { EAgentStatus, EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { buildHarness, type AtlasHarness } from '../../../loop/build-harness'
import { createTempDatabase } from '../../../loop/__tests__/temp-database'
import type { TurnOutcome } from '../../../loop/turn-outcome'
import { scriptedModel } from '../../../model/testing/scripted-model'
import type { ChildRunnerSource } from '../child-runner'
import { AgentSupervisor } from '../supervisor'
import { agentTypeNamed, finished, interrupted, settled } from './fixtures'

type HeldRun = {
  threadId: ThreadId
  kind: string
  settle: (outcome: TurnOutcome) => void
}

const abortAwareRunners = (started: HeldRun[]): ChildRunnerSource => {
  const hold = (args: {
    request: { threadId: ThreadId }
    kind: string
    signal: AbortSignal | undefined
  }): Promise<TurnOutcome> =>
    new Promise<TurnOutcome>((resolve) => {
      args.signal?.addEventListener('abort', () => resolve(interrupted()))
      started.push({ threadId: args.request.threadId, kind: args.kind, settle: resolve })
    })

  return (request) => ({
    say: ({ signal }) => hold({ request, kind: 'say', signal }),
    runTurn: ({ signal }) => hold({ request, kind: 'run', signal }),
    resume: ({ signal }) => hold({ request, kind: 'resume', signal }),
  })
}

type Opened = {
  harness: AtlasHarness
  supervisor: AgentSupervisor
  parent: ThreadId
  started: HeldRun[]
  close: () => Promise<void>
}

const open = async (): Promise<Opened> => {
  const temp = createTempDatabase()
  const harness = await buildHarness({
    databaseUrl: temp.databaseUrl,
    model: scriptedModel({ script: [] }),
  })
  const started: HeldRun[] = []

  return {
    harness,
    started,
    supervisor: new AgentSupervisor({
      log: harness.log,
      threads: harness.threads,
      ids: harness.ids,
      clock: harness.clock,
      agentTypes: [agentTypeNamed({ name: 'explore' }), agentTypeNamed({ name: 'teammate' })],
      runners: abortAwareRunners(started),
      launchDirectory: '/launch',
    }),
    parent: (await harness.threads.create({})).id,
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

const spawnChild = async (args: { entry: Opened; threadId: ThreadId }): Promise<ThreadId> => {
  const outcome = await args.entry.supervisor.spawn({
    threadId: args.threadId,
    agentType: 'explore',
    brief: 'look around',
    intent: 'a look around',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

const spawnTeammate = async (args: { entry: Opened; threadId: ThreadId }): Promise<ThreadId> => {
  const outcome = await args.entry.supervisor.spawn({
    threadId: args.threadId,
    agentType: 'teammate',
    brief: 'own this workstream',
    intent: 'own this workstream',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

const runOf = (args: { entry: Opened; threadId: ThreadId; kind: string }): HeldRun => {
  const run = args.entry.started.find(
    (one) => one.threadId === args.threadId && one.kind === args.kind,
  )
  if (run === undefined) throw new Error(`no ${args.kind} run was started for ${args.threadId}`)
  return run
}

describe("stopping a thread's stepping children", () => {
  it('stops each stepping child, resolves once its step has settled, and returns its id', async () => {
    const entry = await open()
    opened.push(entry)
    const childId = await spawnChild({ entry, threadId: entry.parent })

    const stopped = await entry.supervisor.stopChildren({
      threadId: entry.parent,
      by: EKilledBy.ContainerSwitch,
    })

    expect(stopped).toEqual([childId])

    const snapshot = entry.supervisor
      .list({ threadId: entry.parent })
      .find((one) => one.agentId === childId)
    expect(snapshot?.status).toBe(EAgentStatus.Stopped)
    expect(snapshot?.killedBy).toBe(EKilledBy.ContainerSwitch)
  })

  it('leaves an already-settled child untouched and out of the returned ids', async () => {
    const entry = await open()
    opened.push(entry)
    const childId = await spawnChild({ entry, threadId: entry.parent })
    runOf({ entry, threadId: childId, kind: 'run' }).settle(finished())
    await settled()

    const stopped = await entry.supervisor.stopChildren({
      threadId: entry.parent,
      by: EKilledBy.ContainerSwitch,
    })

    expect(stopped).toEqual([])

    const snapshot = entry.supervisor
      .list({ threadId: entry.parent })
      .find((one) => one.agentId === childId)
    expect(snapshot?.status).toBe(EAgentStatus.Finished)
  })

  it("only stops the calling thread's own children", async () => {
    const entry = await open()
    opened.push(entry)
    const otherParent = (await entry.harness.threads.create({})).id
    const mine = await spawnChild({ entry, threadId: entry.parent })
    const theirs = await spawnChild({ entry, threadId: otherParent })

    const stopping = entry.supervisor.stopChildren({
      threadId: entry.parent,
      by: EKilledBy.ContainerSwitch,
    })
    runOf({ entry, threadId: theirs, kind: 'run' }).settle(finished())
    const stopped = await stopping

    expect(stopped).toEqual([mine])

    const theirSnapshot = entry.supervisor
      .listEverywhere()
      .find((one) => one.agentId === theirs)
    expect(theirSnapshot?.killedBy).toBeUndefined()
  })

  it('still stops a stepping teammate, since teardown is where the session owns teammate lifecycle', async () => {
    const entry = await open()
    opened.push(entry)
    const teammateId = await spawnTeammate({ entry, threadId: entry.parent })

    const stopped = await entry.supervisor.stopChildren({
      threadId: entry.parent,
      by: EKilledBy.SessionEnd,
    })

    expect(stopped).toEqual([teammateId])

    const snapshot = entry.supervisor
      .list({ threadId: entry.parent })
      .find((one) => one.agentId === teammateId)
    expect(snapshot?.status).toBe(EAgentStatus.Stopped)
    expect(snapshot?.killedBy).toBe(EKilledBy.SessionEnd)
  })
})
