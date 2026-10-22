import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EForkMode, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { ForkSeqOutOfRange, ForkSourceMissing } from '../../fork'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, sessionMetaSchema } from '../meta'
import { sessionDirectory, sessionMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore, ThreadNeedsOpeningDrafts } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-thread-fork-'))
  directories.push(dir)
  return dir
}

const said = (text: string): EventDraft => ({ type: 'user-said', text })

function openStore({ home }: { home: string }): {
  log: JsonlEventLog
  threads: JsonlThreadStore
  ids: CountingIds
} {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return { log, threads: new JsonlThreadStore(home, registry, clock, ids, log), ids }
}

async function openParent({ home }: { home: string }): Promise<{
  log: JsonlEventLog
  threads: JsonlThreadStore
  ids: CountingIds
  parentId: ReturnType<typeof toThreadId>
}> {
  const store = openStore({ home })
  const thread = await store.threads.create({ title: 'work', workspace: '/here', repo: '/repo' })
  await store.log.append({
    threadId: thread.id,
    runId: store.ids.nextRunId(),
    drafts: [said('one'), said('two'), said('three'), said('four'), said('five')],
  })
  return { ...store, parentId: thread.id }
}

describe('JsonlThreadStore.fork', () => {
  it('lands a copy fork as its own session with the prefix rewritten under fresh ids', async () => {
    const home = await tempHome()
    const { log, threads, parentId } = await openParent({ home })

    const child = await threads.fork({ from: parentId, seq: 3, mode: EForkMode.Copy, title: 'the copy' })

    expect(child.head).toBe(3)
    expect(child.parent).toEqual({ threadId: parentId, forkSeq: 3 })
    expect(child.forkMode).toBe(EForkMode.Copy)
    expect(child.title).toBe('the copy')
    expect(child.workspace).toBe('/here')
    expect(child.repo).toBe('/repo')

    const sessionDir = sessionDirectory({ home, sessionId: child.id })
    const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
    expect(session).toMatchObject({ id: child.id, title: 'the copy' })

    const prefix = await log.read({ threadId: parentId, upTo: 3 })
    const copied = await log.read({ threadId: child.id })
    expect(copied.map((event) => [event.seq, event.type])).toEqual(prefix.map((event) => [event.seq, event.type]))
    expect(copied.every((event) => event.threadId === child.id)).toBe(true)
    expect(copied.map((event) => event.id)).not.toEqual(prefix.map((event) => event.id))
    expect((await log.read({ threadId: parentId })).length).toBe(5)
  })

  it('continues a copy fork’s sequence above the fork point', async () => {
    const home = await tempHome()
    const { log, threads, ids, parentId } = await openParent({ home })
    const child = await threads.fork({ from: parentId, seq: 3, mode: EForkMode.Copy })

    const appended = await log.append({ threadId: child.id, runId: ids.nextRunId(), drafts: [said('elsewhere')] })

    expect(appended.map((event) => event.seq)).toEqual([4])
    expect((await log.read({ threadId: child.id })).map((event) => event.seq)).toEqual([1, 2, 3, 4])
  })

  it('copies no rows for a reference fork yet reads the inherited prefix', async () => {
    const home = await tempHome()
    const { log, threads, parentId } = await openParent({ home })

    const child = await threads.fork({ from: parentId, seq: 3, mode: EForkMode.Reference })

    expect(child.head).toBe(3)
    expect(child.forkMode).toBe(EForkMode.Reference)
    expect(await log.readOwn({ threadId: child.id })).toEqual([])
    expect((await log.read({ threadId: child.id })).map((event) => event.type)).toEqual([
      'user-said',
      'user-said',
      'user-said',
    ])
    expect((await threads.find({ threadId: child.id }))?.agent).toBeUndefined()
  })

  it('carries the chosen model onto a fork', async () => {
    const home = await tempHome()
    const { threads, parentId } = await openParent({ home })
    await threads.chooseModel({ threadId: parentId, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } })

    const fork = await threads.fork({ from: parentId, seq: 1, mode: EForkMode.Reference })

    expect(fork.model).toEqual({ ref: 'anthropic/claude-opus-5', effort: 'high' })
  })

  it('rejects a source thread that does not exist', async () => {
    const home = await tempHome()
    const { threads } = await openParent({ home })

    await expect(
      threads.fork({ from: toThreadId('no-such-thread'), seq: 0, mode: EForkMode.Copy }),
    ).rejects.toBeInstanceOf(ForkSourceMissing)
  })

  it('rejects a sequence the source never reached', async () => {
    const home = await tempHome()
    const { threads, parentId } = await openParent({ home })

    await expect(threads.fork({ from: parentId, seq: 9, mode: EForkMode.Reference })).rejects.toBeInstanceOf(
      ForkSeqOutOfRange,
    )
  })

  it('lists a fork as its own root in the source’s project', async () => {
    const home = await tempHome()
    const { threads, parentId } = await openParent({ home })
    const forked = await threads.fork({ from: parentId, seq: 1, mode: EForkMode.Reference })

    expect((await threads.list({ project: '/here' })).map((row) => row.id)).toContain(forked.id)
  })
})

describe('JsonlThreadStore.createWithFirstEvents', () => {
  it('opens a thread with its first events stamped', async () => {
    const home = await tempHome()
    const { threads, ids } = openStore({ home })

    const opened = await threads.createWithFirstEvents({
      runId: ids.nextRunId(),
      title: 'opened talking',
      workspace: '/here',
      drafts: [said('one'), said('two')],
    })

    expect(opened.thread.title).toBe('opened talking')
    expect(opened.thread.head).toBe(2)
    expect(opened.events.map((event) => event.seq)).toEqual([1, 2])
    expect((await threads.find({ threadId: opened.thread.id }))?.head).toBe(2)
  })

  it('opens an agent thread inside its spawner’s session', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const spawner = await threads.create({ title: 'main', workspace: '/here' })

    const opened = await threads.createWithFirstEvents({
      runId: ids.nextRunId(),
      agent: { spawnedBy: spawner.id, type: 'explore' },
      drafts: [said('agent turn')],
    })

    expect(opened.thread.agent).toEqual({ spawnedBy: spawner.id, type: 'explore' })
    expect((await threads.spawned({ threadId: spawner.id })).map((row) => row.id)).toEqual([opened.thread.id])
    expect((await log.read({ threadId: opened.thread.id })).map((event) => event.seq)).toEqual([1])
  })

  it('refuses to open a thread unable to ever take a step', async () => {
    const home = await tempHome()
    const { threads, ids } = openStore({ home })

    await expect(threads.createWithFirstEvents({ runId: ids.nextRunId(), drafts: [] })).rejects.toBeInstanceOf(
      ThreadNeedsOpeningDrafts,
    )
  })
})
