import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, EModelFallbackReason } from '@dltech/atlas-core'

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

describe('the model a child fell back to at spawn', () => {
  it('is recorded on the spawner thread right after the spawn itself', async () => {
    const entry = await open()
    const { threadId } = await openChildThread({
      threads: entry.harness.threads,
      log: entry.harness.log,
      ids: entry.harness.ids,
      spawnedBy: entry.parent,
      agentType: agentTypeNamed({ name: 'explore' }),
      brief: 'find the callers',
      intent: 'find the callers',
      model: { ref: 'anthropic/claude-opus-5', effort: 'medium' },
      fellBack: {
        role: 'explore',
        from: { ref: 'openai/gpt-5-codex', label: 'gpt-5-codex' },
        to: { ref: 'anthropic/claude-opus-5', label: 'claude-opus-5' },
        reason: EModelFallbackReason.ProviderNotConnected,
      },
    })

    const events = await entry.harness.log.read({ threadId: entry.parent })

    expect(events.map((event) => event.type)).toEqual(['agent-spawned', 'model-fell-back'])
    expect(events[1]).toMatchObject({
      agentId: threadId,
      role: 'explore',
      from: { ref: 'openai/gpt-5-codex', label: 'gpt-5-codex' },
      to: { ref: 'anthropic/claude-opus-5', label: 'claude-opus-5' },
      reason: EModelFallbackReason.ProviderNotConnected,
    })
  })

  it('records only the spawn when the child runs the model it was given', async () => {
    const entry = await open()

    await openChild(entry)

    const events = await entry.harness.log.read({ threadId: entry.parent })
    expect(events.map((event) => event.type)).toEqual(['agent-spawned'])
  })
})
