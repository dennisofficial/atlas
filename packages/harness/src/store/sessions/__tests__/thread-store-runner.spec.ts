import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExecutionLocation, EForkMode, EHarnessPlacement, ERunner, toThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { tryReadThreadMeta } from '../listing'
import { newThreadMeta } from '../meta'
import { sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function openStore(): Promise<{ home: string; threads: JsonlThreadStore }> {
  const home = await mkdtemp(join(tmpdir(), 'atlas-runner-'))
  directories.push(home)
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return { home, threads: new JsonlThreadStore(home, registry, clock, ids, log) }
}

describe('a thread’s runner', () => {
  it('reads back through find and list once chosen', async () => {
    const { threads } = await openStore()
    const thread = await threads.create({ title: 'on a pod', workspace: '/here' })
    expect(thread.runner).toBeUndefined()

    await threads.chooseRunner({ threadId: thread.id, runner: ERunner.Local })

    expect((await threads.find({ threadId: thread.id }))?.runner).toBe(ERunner.Local)
    const listed = await threads.list({ project: '/here' })
    expect(listed.find((row) => row.id === thread.id)?.runner).toBe(ERunner.Local)
  })

  it('survives a later placement write', async () => {
    const { threads } = await openStore()
    const thread = await threads.create({ workspace: '/here' })
    await threads.chooseRunner({ threadId: thread.id, runner: ERunner.Local })

    await threads.writePlacement({
      threadId: thread.id,
      record: { placement: { harness: EHarnessPlacement.Cloud }, revision: 1 },
    })

    const found = await threads.find({ threadId: thread.id })
    expect(found?.runner).toBe(ERunner.Local)
    expect(found?.executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it('is a no-op for a thread the store does not know', async () => {
    const { threads } = await openStore()
    const threadId = toThreadId('thr_unknown')

    await threads.chooseRunner({ threadId, runner: ERunner.Vercel })

    expect(await threads.find({ threadId })).toBeUndefined()
  })

  it('stays undefined when the meta file predates the field', async () => {
    const { home, threads } = await openStore()
    const thread = await threads.create({ workspace: '/here' })
    const file = threadMetaFile({ sessionDir: sessionDirectory({ home, sessionId: thread.id }), threadId: thread.id })
    const { runner, ...legacy } = newThreadMeta({ id: thread.id, at: '2026-01-01T00:00:00.000Z' })
    void runner
    await writeFile(file, JSON.stringify(legacy))

    expect(tryReadThreadMeta({ file })?.runner).toBeUndefined()
    expect((await threads.find({ threadId: thread.id }))?.runner).toBeUndefined()
  })

  it('carries onto a fork', async () => {
    const { threads } = await openStore()
    const thread = await threads.create({ workspace: '/here' })
    await threads.chooseRunner({ threadId: thread.id, runner: ERunner.Local })

    const forked = await threads.fork({ from: thread.id, seq: 0, mode: EForkMode.Copy })

    expect(forked.runner).toBe(ERunner.Local)
  })
})
