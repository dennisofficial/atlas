import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toRunId, toThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, threadMetaSchema } from '../meta'
import { sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-child-model-'))
  directories.push(dir)
  return dir
}

function openStore({ home }: { home: string }): JsonlThreadStore {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return new JsonlThreadStore(home, registry, clock, ids, log)
}

describe('JsonlThreadStore child model at creation', () => {
  it('writes the given model into a supervised child’s meta and reads it back', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const root = await threads.create({ workspace: '/here' })
    const model = { ref: 'anthropic/claude-sonnet-4-5', effort: 'low' }

    const child = await threads.create({ agent: { spawnedBy: root.id, type: 'explore' }, model })

    expect(child.model).toEqual(model)
    const sessionDir = sessionDirectory({ home, sessionId: root.id })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: child.id }), schema: threadMetaSchema })
    expect(meta).toMatchObject({ modelRef: model.ref, modelEffort: model.effort })
  })

  it('keeps the creation-time model readable after a fresh store instance reopens the home', async () => {
    const home = await tempHome()
    const root = await openStore({ home }).create({ workspace: '/here' })
    const model = { ref: 'openai/gpt-5.1', effort: 'medium' }
    const child = await openStore({ home }).create({ agent: { spawnedBy: root.id, type: 'builder' }, model })

    const reopened = openStore({ home })
    const found = await reopened.find({ threadId: child.id })

    expect(found?.model).toEqual(model)
  })

  it('refuses later changes to a child model or effort but permits initializing a legacy child', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const root = await threads.create({})
    const model = { ref: 'inference/kimi-k3-fast', effort: 'low' }
    const child = await threads.create({ agent: { spawnedBy: root.id, type: 'explore' }, model })
    await expect(threads.chooseModel({ threadId: child.id, model: { ...model, effort: 'high' } }))
      .rejects.toThrow('spawned with')
    await expect(threads.chooseModel({ threadId: child.id, model: { ...model, ref: 'openai/gpt-5' } }))
      .rejects.toThrow('spawned with')
    expect((await threads.find({ threadId: child.id }))?.model).toEqual(model)
    await threads.chooseModel({ threadId: child.id, model })
    const legacy = await threads.create({ agent: { spawnedBy: root.id, type: 'teammate' } })
    await threads.chooseModel({ threadId: legacy.id, model })
    expect((await threads.find({ threadId: legacy.id }))?.model).toEqual(model)
    await threads.chooseModel({ threadId: root.id, model })
    await threads.chooseModel({ threadId: root.id, model: { ...model, effort: 'high' } })
    expect((await threads.find({ threadId: root.id }))?.model?.effort).toBe('high')
  })

  it('leaves the model unset when creation passes none', async () => {
    const home = await tempHome()
    const threads = openStore({ home })

    const thread = await threads.create({ workspace: '/here' })

    const found = await threads.find({ threadId: thread.id })
    expect(found?.model).toBeUndefined()
    const sessionDir = sessionDirectory({ home, sessionId: thread.id })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: thread.id }), schema: threadMetaSchema })
    expect(meta).toMatchObject({ modelRef: null, modelEffort: null })
  })

  it('writes the model for a thread opened with its first events', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const model = { ref: 'anthropic/claude-opus-5', effort: 'high' }

    const { thread } = await threads.createWithFirstEvents({
      threadId: toThreadId('opened-with-model'),
      drafts: [{ type: 'user-said', text: 'hello' }],
      runId: toRunId('run-one'),
      workspace: '/here',
      model,
    })

    expect(thread.model).toEqual(model)
    expect((await threads.find({ threadId: thread.id }))?.model).toEqual(model)
  })
})
