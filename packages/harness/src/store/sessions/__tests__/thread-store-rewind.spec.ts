import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ECompactionAnchor, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, threadMetaSchema } from '../meta'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-thread-rewind-'))
  directories.push(dir)
  return dir
}

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const linked = ({ number }: { number: number }): EventDraft => ({
  type: 'pull-request-linked',
  number,
  url: `https://github.com/acme/app/pull/${number}`,
  repo: 'github.com/acme/app',
  branch: 'dennis/fix',
})

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

async function openThread({
  home,
  drafts,
}: {
  home: string
  drafts: readonly EventDraft[]
}): Promise<{ log: JsonlEventLog; threads: JsonlThreadStore; ids: CountingIds; threadId: ThreadId }> {
  const store = openStore({ home })
  const thread = await store.threads.create({ title: 'work', workspace: '/here' })
  await store.log.append({ threadId: thread.id, runId: store.ids.nextRunId(), drafts })
  return { ...store, threadId: thread.id }
}

const shapeOf = async ({ log, threadId }: { log: JsonlEventLog; threadId: ThreadId }) =>
  (await log.read({ threadId: threadId })).map((event) => [event.seq, event.type])

describe('JsonlThreadStore.rewind', () => {
  it('drops the suffix, moves the head back, and lets the next append take the freed seq', async () => {
    const home = await tempHome()
    const { log, threads, ids, threadId } = await openThread({ home, drafts: [said('one'), said('two'), said('three')] })

    await threads.rewind({ threadId: threadId, toSeq: 1 })

    expect(await shapeOf({ log, threadId })).toEqual([[1, 'user-said']])
    expect((await threads.find({ threadId: threadId }))?.head).toBe(1)

    const appended = await log.append({ threadId: threadId, runId: ids.nextRunId(), drafts: [said('two again')] })
    expect(appended.map((event) => event.seq)).toEqual([2])
    expect((await threads.find({ threadId: threadId }))?.head).toBe(2)
  })

  it('empties the thread when rewound to zero', async () => {
    const home = await tempHome()
    const { log, threads, ids, threadId } = await openThread({ home, drafts: [said('one'), said('two')] })

    await threads.rewind({ threadId: threadId, toSeq: 0 })

    expect(await shapeOf({ log, threadId })).toEqual([])
    expect((await threads.find({ threadId: threadId }))?.head).toBe(0)
    const appended = await log.append({ threadId: threadId, runId: ids.nextRunId(), drafts: [said('fresh')] })
    expect(appended[0]?.seq).toBe(1)
  })

  it('regenerates every surviving event id, because a rewrite must never mutate a body under a stable id', async () => {
    const home = await tempHome()
    const { log, threads, threadId } = await openThread({ home, drafts: [said('one'), said('two'), said('three')] })
    const before = (await log.read({ threadId: threadId })).map((event) => event.id)

    await threads.rewind({ threadId: threadId, toSeq: 2 })

    const after = (await log.read({ threadId: threadId })).map((event) => event.id)
    expect(after).toHaveLength(2)
    expect(after).not.toEqual(before.slice(0, 2))
  })

  it('deletes an unreferenced cut agent’s files and detaches a referenced one', async () => {
    const home = await tempHome()
    const { threads, threadId } = await openThread({ home, drafts: [said('one'), said('two')] })
    const root = threadId
    const lonely = await threads.create({ agent: { spawnedBy: root, type: 'explore' } })
    const parent = await threads.create({ agent: { spawnedBy: root, type: 'builder' } })
    const grandchild = await threads.create({ agent: { spawnedBy: parent.id, type: 'explore' } })
    const sessionDir = sessionDirectory({ home, sessionId: threadId })

    await threads.rewind({ threadId: root, toSeq: 1, cutAgents: [lonely.id, parent.id] })

    expect(readMetaSync({ file: threadMetaFile({ sessionDir, threadId: lonely.id }), schema: threadMetaSchema })).toBeUndefined()
    expect(existsSync(eventLogFile({ sessionDir, threadId: lonely.id }))).toBe(false)
    const detached = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: parent.id }), schema: threadMetaSchema })
    expect(detached).toMatchObject({ spawnerThreadId: null, agentType: null })
    expect(readMetaSync({ file: threadMetaFile({ sessionDir, threadId: grandchild.id }), schema: threadMetaSchema })).toBeDefined()
    expect((await threads.find({ threadId: parent.id }))?.agent).toBeUndefined()
  })
})

describe('JsonlThreadStore.compact', () => {
  it('appends the watermark past the head and leaves every row where it was', async () => {
    const home = await tempHome()
    const { log, threads, threadId } = await openThread({
      home,
      drafts: [said('one'), said('two'), said('three'), said('four')],
    })

    const replaced = await threads.compact({
      threadId: threadId,
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 2,
      summary: 'the opening',
    })

    expect(replaced).toBe(2)
    expect(await shapeOf({ log, threadId })).toEqual([
      [1, 'user-said'],
      [2, 'user-said'],
      [3, 'user-said'],
      [4, 'user-said'],
      [5, 'history-compacted'],
    ])
    expect((await threads.find({ threadId: threadId }))?.head).toBe(5)

    const watermark = (await log.read({ threadId: threadId })).at(-1)
    expect(watermark?.type === 'history-compacted' && watermark.summary).toBe('the opening')
    expect(watermark?.type === 'history-compacted' && watermark.replaced).toBe(2)
  })
})

describe('JsonlThreadStore.summarise', () => {
  it('replaces the range with a stand-in at the last vacated seat', async () => {
    const home = await tempHome()
    const { log, threads, threadId } = await openThread({
      home,
      drafts: [said('one'), said('two'), said('three'), said('four')],
    })

    const replaced = await threads.summarise({
      threadId: threadId,
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 2,
      summary: 'the opening',
    })

    expect(replaced).toBe(2)
    expect(await shapeOf({ log, threadId })).toEqual([
      [2, 'history-compacted'],
      [3, 'user-said'],
      [4, 'user-said'],
    ])
    expect((await threads.find({ threadId: threadId }))?.head).toBe(4)
  })

  it('replaces the tail when anchored on the suffix, and the head derives from the last line', async () => {
    const home = await tempHome()
    const { log, threads, threadId } = await openThread({
      home,
      drafts: [said('one'), said('two'), said('three'), said('four')],
    })

    await threads.summarise({
      threadId: threadId,
      anchor: ECompactionAnchor.Suffix,
      fromSeq: 3,
      throughSeq: 4,
      summary: 'the closing',
    })

    expect(await shapeOf({ log, threadId })).toEqual([
      [1, 'user-said'],
      [2, 'user-said'],
      [3, 'history-compacted'],
    ])
    expect((await threads.find({ threadId: threadId }))?.head).toBe(3)
  })

  it('spares what survives a summary and stands the summary in a vacated seat', async () => {
    const home = await tempHome()
    const { log, threads, threadId } = await openThread({
      home,
      drafts: [said('one'), linked({ number: 401 }), said('two'), said('three')],
    })

    const replaced = await threads.summarise({
      threadId: threadId,
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 3,
      summary: 'the opening',
    })

    expect(replaced).toBe(2)
    expect(await shapeOf({ log, threadId })).toEqual([
      [2, 'pull-request-linked'],
      [3, 'history-compacted'],
      [4, 'user-said'],
    ])
  })

  it('persists the rewrite across a fresh registry', async () => {
    const home = await tempHome()
    const { threads, threadId } = await openThread({ home, drafts: [said('one'), said('two'), said('three')] })

    await threads.summarise({
      threadId: threadId,
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 2,
      summary: 'the opening',
    })

    const reopened = openStore({ home })
    expect(await shapeOf({ log: reopened.log, threadId })).toEqual([
      [2, 'history-compacted'],
      [3, 'user-said'],
    ])
    expect((await reopened.threads.find({ threadId: threadId }))?.head).toBe(3)
  })

  it('drops cut agents the same way rewind does', async () => {
    const home = await tempHome()
    const { threads, threadId } = await openThread({ home, drafts: [said('one'), said('two')] })
    const root = threadId
    const agent = await threads.create({ agent: { spawnedBy: root, type: 'explore' } })
    const sessionDir = sessionDirectory({ home, sessionId: threadId })

    await threads.summarise({
      threadId: root,
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 2,
      summary: 'everything',
      cutAgents: [agent.id],
    })

    expect(readMetaSync({ file: threadMetaFile({ sessionDir, threadId: agent.id }), schema: threadMetaSchema })).toBeUndefined()
  })
})
