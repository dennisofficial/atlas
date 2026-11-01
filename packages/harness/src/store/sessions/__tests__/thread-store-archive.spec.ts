import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId, toRunId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { newThreadMeta, writeMeta } from '../meta'
import { sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

function storeAt(home: string) {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('archive')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return { threads: new JsonlThreadStore(home, registry, clock, ids, log), log }
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-archive-'))
  homes.push(home)
  return { home, ...storeAt(home) }
}

describe('persistent thread archive', () => {
  it('archives, reloads, lists and restores without changing history or activity', async () => {
    const { home, threads, log } = await fixture()
    const thread = await threads.create({ workspace: '/here' })
    expect(thread.archivedAt).toBeUndefined()
    await log.append({
      threadId: thread.id,
      runId: toRunId('run'),
      drafts: [{ type: 'user-said', text: 'keep' }],
    })
    const before = await threads.find({ threadId: thread.id })
    expect(await threads.setArchived({ threadId: thread.id, archived: true })).toBe(true)
    const reloaded = storeAt(home)
    const archived = await reloaded.threads.find({ threadId: thread.id })
    expect(archived?.archivedAt).toBeString()
    expect(archived?.updatedAt).toBe(before?.updatedAt)
    expect((await reloaded.threads.list({ project: '/here' }))[0]?.archivedAt).toBe(
      archived?.archivedAt,
    )
    await reloaded.threads.setArchived({ threadId: thread.id, archived: true })
    expect((await threads.find({ threadId: thread.id }))?.archivedAt).toBe(archived?.archivedAt)
    await reloaded.threads.setArchived({ threadId: thread.id, archived: false })
    expect((await storeAt(home).threads.find({ threadId: thread.id }))?.archivedAt).toBeNull()
    expect(await reloaded.log.read({ threadId: thread.id })).toHaveLength(1)
  })

  it('does not create a missing record', async () => {
    const { threads } = await fixture()
    const threadId = toThreadId('missing')
    expect(await threads.setArchived({ threadId, archived: true })).toBe(false)
    expect(await threads.find({ threadId })).toBeUndefined()
  })

  it('preserves archive state against stale metadata writers', async () => {
    const { home, threads } = await fixture()
    const thread = await threads.create({ workspace: '/here' })
    const file = threadMetaFile({
      sessionDir: sessionDirectory({ home, sessionId: thread.id }),
      threadId: thread.id,
    })
    const stale = newThreadMeta({ id: thread.id, at: thread.createdAt })
    await threads.setArchived({ threadId: thread.id, archived: true })
    await writeMeta({ file, meta: stale })
    expect((await threads.find({ threadId: thread.id }))?.archivedAt).toBeString()
    await threads.setArchived({ threadId: thread.id, archived: false })
    await writeMeta({ file, meta: { ...stale, archivedAt: '2026-01-01T00:00:00.000Z' } })
    expect((await threads.find({ threadId: thread.id }))?.archivedAt).toBeNull()
  })
})
