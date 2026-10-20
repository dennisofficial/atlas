import { afterEach, describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  ExecutionLocationSinkPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { openSupervisor, type OpenedSupervisor } from './fixtures'

class FakeLocationSink extends ExecutionLocationSinkPort {
  readonly refreshed: ThreadId[] = []

  refresh(args: { threadId: ThreadId }): void {
    this.refreshed.push(args.threadId)
  }
}

const opened: OpenedSupervisor[] = []

const open = async (sink: ExecutionLocationSinkPort): Promise<OpenedSupervisor> => {
  const entry = await openSupervisor({ sink })
  opened.push(entry)
  return entry
}

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

describe('the location a spawn hands to the live routing map', () => {
  it('refreshes the child’s placement once its thread row carries the spawner’s location', async () => {
    const sink = new FakeLocationSink()
    const entry = await open(sink)
    await entry.harness.threads.chooseExecutionLocation({
      threadId: entry.parent,
      location: EExecutionLocation.Docker,
    })

    const outcome = await entry.supervisor.spawn({
      threadId: entry.parent,
      agentType: 'explore',
      brief: 'look around',
      intent: 'a look around',
    })
    if (!outcome.ok) throw new Error(outcome.reason)

    expect(sink.refreshed).toEqual([outcome.snapshot.agentId])
    const stored = await entry.harness.threads.find({ threadId: outcome.snapshot.agentId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Docker)
  })

  it('refreshes nothing when the spawner never chose a location', async () => {
    const sink = new FakeLocationSink()
    const entry = await open(sink)

    const outcome = await entry.supervisor.spawn({
      threadId: entry.parent,
      agentType: 'explore',
      brief: 'look around',
      intent: 'a look around',
    })
    if (!outcome.ok) throw new Error(outcome.reason)

    expect(sink.refreshed).toEqual([])
  })

  it('spawns fine with no sink handed over, the no-op default answering instead', async () => {
    const entry = await openSupervisor()
    opened.push(entry)
    await entry.harness.threads.chooseExecutionLocation({
      threadId: entry.parent,
      location: EExecutionLocation.Docker,
    })

    const outcome = await entry.supervisor.spawn({
      threadId: entry.parent,
      agentType: 'explore',
      brief: 'look around',
      intent: 'a look around',
    })

    expect(outcome.ok).toBe(true)
  })
})
