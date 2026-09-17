import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, ExecutionLocationSinkPort, type ThreadId } from '@dltech/atlas-core'

import { finished, openSupervisor, settled, type OpenedSupervisor } from './fixtures'

class FakeLocationSink extends ExecutionLocationSinkPort {
  readonly noted: { threadId: ThreadId; location: EExecutionLocation }[] = []

  note(args: { threadId: ThreadId; location: EExecutionLocation }): void {
    this.noted.push(args)
  }
}

const opened: OpenedSupervisor[] = []

const spawnChild = async (args: {
  entry: OpenedSupervisor
  threadId: ThreadId
}): Promise<ThreadId> => {
  const outcome = await args.entry.supervisor.spawn({
    threadId: args.threadId,
    agentType: 'explore',
    brief: 'look around',
    intent: 'a look around',
  })
  if (!outcome.ok) throw new Error(outcome.reason)
  return outcome.snapshot.agentId
}

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

describe("marking a thread's children relocated", () => {
  it('flips the stored location and notes the sink for a stepping child, without touching its log', async () => {
    const sink = new FakeLocationSink()
    const entry = await openSupervisor({ sink })
    opened.push(entry)
    const childId = await spawnChild({ entry, threadId: entry.parent })

    await entry.supervisor.markChildrenRelocated({
      threadId: entry.parent,
      location: EExecutionLocation.Cloud,
    })

    expect(sink.noted).toEqual([{ threadId: childId, location: EExecutionLocation.Cloud }])

    const stored = await entry.harness.threads.find({ threadId: childId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Cloud)

    const events = await entry.harness.log.read({ threadId: childId })
    expect(events.some((event) => event.type === 'location-changed')).toBe(false)
  })

  it('relocates a settled child exactly the same as a stepping one', async () => {
    const sink = new FakeLocationSink()
    const entry = await openSupervisor({ sink })
    opened.push(entry)
    const childId = await spawnChild({ entry, threadId: entry.parent })

    const run = entry.runners.started.find((one) => one.threadId === childId)
    if (run === undefined) throw new Error('no run was started')
    run.settle(finished())
    await settled()

    await entry.supervisor.markChildrenRelocated({
      threadId: entry.parent,
      location: EExecutionLocation.Cloud,
    })

    expect(sink.noted).toEqual([{ threadId: childId, location: EExecutionLocation.Cloud }])

    const stored = await entry.harness.threads.find({ threadId: childId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it("leaves the children of every other thread exactly where they are", async () => {
    const sink = new FakeLocationSink()
    const entry = await openSupervisor({ sink })
    opened.push(entry)
    const otherParent = (await entry.harness.threads.create({})).id
    const mine = await spawnChild({ entry, threadId: entry.parent })
    const theirs = await spawnChild({ entry, threadId: otherParent })

    await entry.supervisor.markChildrenRelocated({
      threadId: entry.parent,
      location: EExecutionLocation.Cloud,
    })

    expect(sink.noted).toEqual([{ threadId: mine, location: EExecutionLocation.Cloud }])

    const theirStored = await entry.harness.threads.find({ threadId: theirs })
    expect(theirStored?.executionLocation).toBeUndefined()
  })
})
