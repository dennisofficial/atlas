import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { openChildThread } from '../open-child'
import { agentTypeNamed, openSupervisor, type OpenedSupervisor } from './fixtures'

const opened: OpenedSupervisor[] = []

const open = async (): Promise<OpenedSupervisor> => {
  const entry = await openSupervisor()
  opened.push(entry)
  return entry
}

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const openChild = (entry: OpenedSupervisor) =>
  openChildThread({
    threads: entry.harness.threads,
    log: entry.harness.log,
    ids: entry.harness.ids,
    spawnedBy: entry.parent,
    agentType: agentTypeNamed({ name: 'explore' }),
    brief: 'find the callers',
    intent: 'find the callers',
  })

describe('the execution location a child thread opens with', () => {
  it("is the spawner's own, so a docker parent's child never falls back to the host", async () => {
    const entry = await open()
    await entry.harness.threads.chooseExecutionLocation({
      threadId: entry.parent,
      location: EExecutionLocation.Docker,
    })

    const { threadId, inheritedLocation } = await openChild(entry)

    expect(inheritedLocation).toBe(EExecutionLocation.Docker)
    expect((await entry.harness.threads.find({ threadId }))?.executionLocation).toBe(
      EExecutionLocation.Docker,
    )
  })

  it('stays undecided when the spawner never chose one, so the default still answers', async () => {
    const entry = await open()

    const { threadId, inheritedLocation } = await openChild(entry)

    expect(inheritedLocation).toBeUndefined()
    expect((await entry.harness.threads.find({ threadId }))?.executionLocation).toBeUndefined()
  })
})
