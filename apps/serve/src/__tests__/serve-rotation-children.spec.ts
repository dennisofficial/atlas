import { afterEach, describe, expect, it } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { EAgentRestart, EAgentStatus } from '@dltech/atlas-core'
import { persistSandboxRotationReceipt, readSandboxRotationState } from '@dltech/atlas-harness'

import { rotationChildFixture } from './serve-rotation-child-fixture'
import { childId, cleanupRotationFixtures, threadId } from './serve-rotation-fixture'
import { scratchTranscriptStore } from './transcript-store-fixture'

const eventually = async (predicate: () => boolean | Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (await predicate()) return
    await Bun.sleep(5)
  }
  throw new Error('child rotation recovery did not settle')
}

const owedChildren = async (home: string) =>
  (await readSandboxRotationState({ atlasHome: home }))?.resumeChildren ?? []

afterEach(cleanupRotationFixtures)

describe('queued Finished-child continuation across serve boots', () => {
  it('seeds the queued child transcript beside its metadata in the parent session', async () => {
    const fixture = await rotationChildFixture()
    expect(await readdir(join(fixture.home, 'sessions'))).toEqual([threadId])
    const disk = scratchTranscriptStore({ prefix: 'rotation-verify', home: fixture.home })
    const events = await disk.log.readOwn({ threadId: childId })
    expect(events.filter((event) => event.type === 'user-said')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ type: 'user-said', text: 'queued child follow-up' })
  })

  it('wakes the original Finished child without a client or duplicate message and retains its obligation until durable completion', async () => {
    const fixture = await rotationChildFixture()
    await persistSandboxRotationReceipt({ atlasHome: fixture.home, receipt: { ...fixture.receipt, resumeParent: true } })
    const first = await fixture.boot()
    const handle = await first.starting
    await eventually(() => first.steps() === 1)
    await eventually(async () => (await readSandboxRotationState({ atlasHome: fixture.home }))?.resumeParent === false)
    expect(first.resumed()).toBe(1)
    expect(first.ran()).toBe(0)
    expect(first.supervisor()?.list({ threadId }).find((child) => child.agentId === childId)?.status).toBe(EAgentStatus.Running)
    expect(await owedChildren(fixture.home)).toEqual([childId])
    const parent = await first.disk.log.readOwn({ threadId })
    expect(parent.filter((event) => event.type === 'agent-spawned')).toHaveLength(1)
    expect(parent.findLast((event) => event.type === 'agent-restarted')).toMatchObject({ agentId: childId, via: EAgentRestart.Wake })
    const before = await first.disk.log.readOwn({ threadId: childId })
    expect(before.filter((event) => event.type === 'user-said')).toHaveLength(2)
    first.modelGate.release()
    await eventually(async () => (await owedChildren(fixture.home)).length === 0)
    const completed = await first.disk.log.readOwn({ threadId: childId })
    expect(completed.at(-1)).toMatchObject({ type: 'assistant-said', parts: [{ type: 'text', text: 'queued job complete' }] })
    expect(completed.filter((event) => event.type === 'user-said')).toHaveLength(2)
    await handle.close()
    const second = await fixture.boot()
    await second.starting
    expect(second.steps()).toBe(0)
    expect(second.resumed()).toBe(0)
    expect(await owedChildren(fixture.home)).toEqual([])
    second.modelGate.release()
  }, 20_000)

  it('retains a started child obligation after a model crash and recovers it from the same drive on the next boot', async () => {
    const fixture = await rotationChildFixture()
    const first = await fixture.boot()
    const handle = await first.starting
    await eventually(() => first.steps() === 1)
    first.modelGate.fail(new Error('crashed before committing the queued reply'))
    await eventually(() => first.supervisor()?.list({ threadId }).find((child) => child.agentId === childId)?.status === EAgentStatus.Failed)
    expect(await owedChildren(fixture.home)).toEqual([childId])
    await handle.close()
    const second = await fixture.boot()
    await second.starting
    await eventually(() => second.steps() === 1)
    expect(await owedChildren(fixture.home)).toEqual([childId])
    second.modelGate.release()
    await eventually(async () => (await owedChildren(fixture.home)).length === 0)
    expect((await second.disk.log.readOwn({ threadId: childId })).filter((event) => event.type === 'user-said')).toHaveLength(2)
    expect((await second.disk.log.readOwn({ threadId })).filter((event) => event.type === 'agent-spawned')).toHaveLength(1)
  }, 20_000)
})
