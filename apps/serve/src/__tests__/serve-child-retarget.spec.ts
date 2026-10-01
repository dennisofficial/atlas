import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  buildHarness,
  buildSessionArchive,
  extractSessionArchive,
  EClientRequest,
  scriptedModel,
  sessionDirectory,
} from '@dltech/atlas-harness'

import { ORIGINAL, PICKED, openChildModelServe } from './child-model-fixture'

const opened: Awaited<ReturnType<typeof openChildModelServe>>[] = []

const start = async () => {
  const fixture = await openChildModelServe()
  opened.push(fixture)
  return fixture
}

afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.close()
})

describe('operator child model retarget over the cloud channel', () => {
  it('retargets a direct child and broadcasts its full pair to another client without selecting main', async () => {
    const fixture = await start()
    const first = await fixture.connect()
    const second = await fixture.connect()
    const pushed = new Promise<{ threadId: ThreadId; model: typeof PICKED }>((resolve) => {
      second.channel.onThreadModelChanged(resolve)
    })

    await first.threads.chooseModel({ threadId: fixture.teammate.id, model: PICKED, retarget: true })

    expect(await pushed).toEqual({ threadId: fixture.teammate.id, model: PICKED })
    expect((await second.threads.find({ threadId: fixture.teammate.id }))?.model).toEqual(PICKED)
    expect((await fixture.harness.threads.find({ threadId: fixture.root.id }))?.model).toEqual(ORIGINAL)
    expect((await fixture.harness.threads.find({ threadId: fixture.child.id }))?.model).toEqual(ORIGINAL)
    expect(fixture.selected).toEqual([])
  })

  it('retargets a teammate descendant and retains it after reopening the JSONL store', async () => {
    const fixture = await start()
    const remote = await fixture.connect()

    await remote.threads.chooseModel({ threadId: fixture.child.id, model: PICKED, retarget: true })

    const reopened = await buildHarness({ home: fixture.home, model: scriptedModel({ script: [] }) })
    try {
      expect((await reopened.threads.find({ threadId: fixture.child.id }))?.model).toEqual(PICKED)
      expect((await remote.threads.find({ threadId: fixture.teammate.id }))?.model).toEqual(ORIGINAL)
      expect(fixture.selected).toEqual([])
    } finally {
      await reopened.close()
    }
  })

  it('keeps the retargeted pair through a session archive relocation', async () => {
    const fixture = await start()
    const remote = await fixture.connect()
    await remote.threads.chooseModel({ threadId: fixture.child.id, model: PICKED, retarget: true })
    const archive = await buildSessionArchive({
      sessionDir: sessionDirectory({ home: fixture.home, sessionId: fixture.root.id }),
    })
    if (archive === undefined) throw new Error('the retargeted session had no archive')
    const home = await mkdtemp(join(tmpdir(), 'atlas-retarget-relocated-'))
    try {
      await extractSessionArchive({
        archive,
        sessionDir: sessionDirectory({ home, sessionId: fixture.root.id }),
      })
      const relocated = await buildHarness({ home, model: scriptedModel({ script: [] }) })
      try {
        expect((await relocated.threads.find({ threadId: fixture.child.id }))?.model).toEqual(PICKED)
        expect((await relocated.threads.find({ threadId: fixture.root.id }))?.model).toEqual(ORIGINAL)
      } finally {
        await relocated.close()
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it.each([undefined, false])('refuses a child pick without a true override (%s)', async (retarget) => {
    const fixture = await start()
    const remote = await fixture.connect()
    const heard: unknown[] = []
    remote.threads.onModelChosen((model) => void heard.push(model))

    await expect(remote.threads.chooseModel({ threadId: fixture.child.id, model: PICKED, retarget }))
      .rejects.toThrow('explicit operator retarget')

    expect((await fixture.harness.threads.find({ threadId: fixture.child.id }))?.model).toEqual(ORIGINAL)
    expect(heard).toEqual([])
    expect(fixture.selected).toEqual([])
  })

  it('refuses foreign roots and their children even with the override', async () => {
    const fixture = await start()
    const remote = await fixture.connect()
    const foreign = await fixture.harness.threads.create({ model: ORIGINAL })
    const foreignChild = await fixture.harness.threads.create({
      agent: { spawnedBy: foreign.id, type: 'explore' }, model: ORIGINAL,
    })
    for (const threadId of [foreign.id, foreignChild.id, toThreadId('missing')]) {
      await expect(remote.threads.chooseModel({ threadId, model: PICKED, retarget: true }))
        .rejects.toThrow('served session')
    }
    expect((await fixture.harness.threads.find({ threadId: foreignChild.id }))?.model).toEqual(ORIGINAL)
    expect(fixture.selected).toEqual([])
  })

  it('rejects a malformed override without changing the child', async () => {
    const fixture = await start()
    const remote = await fixture.connect()
    await expect(remote.channel.request({
      op: EClientRequest.SetThreadModel,
      params: { threadId: fixture.child.id, model: PICKED, retarget: 'true' },
    })).rejects.toThrow('set-thread-model wants')
    expect((await remote.threads.find({ threadId: fixture.child.id }))?.model).toEqual(ORIGINAL)
    expect(fixture.selected).toEqual([])
  })

  it('retargets only the effort and broadcasts the full saved pair', async () => {
    const fixture = await start()
    const remote = await fixture.connect()
    const picked = { ...ORIGINAL, effort: 'high' }
    const pushed = new Promise<unknown>((resolve) => remote.channel.onThreadModelChanged(resolve))

    await remote.threads.chooseModel({ threadId: fixture.child.id, model: picked, retarget: true })

    expect(await pushed).toEqual({ threadId: fixture.child.id, model: picked })
    expect((await remote.threads.find({ threadId: fixture.child.id }))?.model).toEqual(picked)
    expect(fixture.selected).toEqual([])
  })

  it('keeps main-thread switching immediate and leaves existing children untouched', async () => {
    const fixture = await start()
    const remote = await fixture.connect()
    await remote.threads.chooseModel({ threadId: fixture.root.id, model: PICKED })
    expect(fixture.selected).toEqual([PICKED])
    expect((await remote.threads.find({ threadId: fixture.teammate.id }))?.model).toEqual(ORIGINAL)
    expect((await remote.threads.find({ threadId: fixture.child.id }))?.model).toEqual(ORIGINAL)
  })
})
