import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EExecutionLocation,
  EKilledBy,
  ExecutionLocationSinkPort,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'

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

class RecordingSink extends ExecutionLocationSinkPort {
  readonly noted: { threadId: ThreadId; location: EExecutionLocation }[] = []

  constructor(private readonly order: string[]) {
    super()
  }

  note(args: { threadId: ThreadId; location: EExecutionLocation }): void {
    this.noted.push(args)
    this.order.push(`note:${args.threadId}:${args.location}`)
  }
}

const recordingLog = (inner: EventLogPort, order: string[]): EventLogPort => ({
  append: (args) => {
    for (const draft of args.drafts) order.push(`append:${args.threadId}:${draft.type}`)
    return inner.append(args)
  },
  read: (args) => inner.read(args),
  head: (args) => inner.head(args),
  readOwn: (args) => inner.readOwn(args),
  replace: (args) => inner.replace(args),
})

const recordingRunners = (order: string[], started: HeldRun[]): ChildRunnerSource => {
  const hold = (
    request: { threadId: ThreadId },
    kind: string,
    signal: AbortSignal | undefined,
  ): Promise<TurnOutcome> => {
    order.push(`${kind}:${request.threadId}`)
    return new Promise<TurnOutcome>((resolve) => {
      signal?.addEventListener('abort', () => {
        order.push(`abort:${request.threadId}`)
        resolve(interrupted())
      })
      started.push({ threadId: request.threadId, kind, settle: resolve })
    })
  }

  return (request) => ({
    say: ({ signal }) => hold(request, 'say', signal),
    runTurn: ({ signal }) => hold(request, 'run', signal),
    resume: ({ signal }) => hold(request, 'resume', signal),
  })
}

type Opened = {
  harness: AtlasHarness
  supervisor: AgentSupervisor
  parent: ThreadId
  order: string[]
  started: HeldRun[]
  sink: RecordingSink
  close: () => Promise<void>
}

const open = async (): Promise<Opened> => {
  const temp = createTempDatabase()
  const harness = await buildHarness({
    databaseUrl: temp.databaseUrl,
    model: scriptedModel({ script: [] }),
  })
  const order: string[] = []
  const started: HeldRun[] = []
  const sink = new RecordingSink(order)

  return {
    harness,
    order,
    started,
    sink,
    supervisor: new AgentSupervisor({
      log: recordingLog(harness.log, order),
      threads: harness.threads,
      ids: harness.ids,
      clock: harness.clock,
      agentTypes: [agentTypeNamed({ name: 'explore' })],
      runners: recordingRunners(order, started),
      launchDirectory: '/launch',
      sink,
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

const spawnChild = async (entry: Opened, threadId: ThreadId): Promise<ThreadId> => {
  const outcome = await entry.supervisor.spawn({
    threadId,
    agentType: 'explore',
    brief: 'look around',
    intent: 'a look around',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

const runOf = (entry: Opened, threadId: ThreadId, kind: string): HeldRun => {
  const run = entry.started.find((one) => one.threadId === threadId && one.kind === kind)
  if (run === undefined) throw new Error(`no ${kind} run was started for ${threadId}`)
  return run
}

describe('relocating a stepping child', () => {
  it('stops it, moves its location, and resumes it over its log, in that order', async () => {
    const entry = await open()
    opened.push(entry)
    const childId = await spawnChild(entry, entry.parent)

    const relocating = entry.supervisor.relocateChildren({
      threadId: entry.parent,
      location: EExecutionLocation.Docker,
    })
    await relocating

    const order = entry.order
    const abortedAt = order.indexOf(`abort:${childId}`)
    const appendedAt = order.indexOf(`append:${childId}:location-changed`)
    const notedAt = order.indexOf(`note:${childId}:${EExecutionLocation.Docker}`)
    const resumedAt = order.indexOf(`resume:${childId}`)
    expect(abortedAt).toBeGreaterThanOrEqual(0)
    expect(abortedAt).toBeLessThan(notedAt)
    expect(notedAt).toBeLessThan(appendedAt)
    expect(appendedAt).toBeLessThan(resumedAt)

    const stored = await entry.harness.threads.find({ threadId: childId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Docker)

    const events = await entry.harness.log.read({ threadId: childId })
    const moved = events.find((event) => event.type === 'location-changed')
    expect(moved).toMatchObject({
      from: EExecutionLocation.Host,
      to: EExecutionLocation.Docker,
    })

    const snapshot = entry.supervisor
      .list({ threadId: entry.parent })
      .find((one) => one.agentId === childId)
    expect(snapshot?.status).toBe(EAgentStatus.Running)

    runOf(entry, childId, 'resume').settle(finished())
    await settled()

    const endings = entry.supervisor
      .drainNotifications({ threadId: entry.parent })
      .flatMap((draft) => (draft.type === 'agent-ended' ? [draft] : []))
    expect(endings[0]?.killedBy).toBe(EKilledBy.ContainerSwitch)
    expect(endings[1]?.status).toBe(EAgentStatus.Finished)
  })
})

describe('relocating a child that is not stepping', () => {
  it('moves its location and log without aborting or resuming it', async () => {
    const entry = await open()
    opened.push(entry)
    const childId = await spawnChild(entry, entry.parent)
    runOf(entry, childId, 'run').settle(finished())
    await settled()

    await entry.supervisor.relocateChildren({
      threadId: entry.parent,
      location: EExecutionLocation.Docker,
    })

    expect(entry.order).not.toContain(`abort:${childId}`)
    expect(entry.order).not.toContain(`resume:${childId}`)
    expect(entry.order).toContain(`append:${childId}:location-changed`)

    const stored = await entry.harness.threads.find({ threadId: childId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Docker)

    const snapshot = entry.supervisor
      .list({ threadId: entry.parent })
      .find((one) => one.agentId === childId)
    expect(snapshot?.status).toBe(EAgentStatus.Finished)
  })
})

describe("relocating one thread's children", () => {
  it('leaves the children of every other thread exactly where they are', async () => {
    const entry = await open()
    opened.push(entry)
    const otherParent = (await entry.harness.threads.create({})).id
    const mine = await spawnChild(entry, entry.parent)
    const theirs = await spawnChild(entry, otherParent)

    const relocating = entry.supervisor.relocateChildren({
      threadId: entry.parent,
      location: EExecutionLocation.Docker,
    })
    runOf(entry, theirs, 'run').settle(finished())
    await relocating

    expect(entry.order).not.toContain(`abort:${theirs}`)
    expect(entry.order).not.toContain(`resume:${theirs}`)
    expect(entry.order).not.toContain(`append:${theirs}:location-changed`)
    expect(entry.sink.noted).toEqual([{ threadId: mine, location: EExecutionLocation.Docker }])

    const stored = await entry.harness.threads.find({ threadId: theirs })
    expect(stored?.executionLocation).toBeUndefined()

    runOf(entry, mine, 'resume').settle(finished())
    await settled()
  })
})
