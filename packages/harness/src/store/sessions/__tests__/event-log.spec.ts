import { afterEach, describe, expect, it } from 'bun:test'
import { appendFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EForkMode, toThreadId, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { writeMeta, newThreadMeta } from '../meta'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-jsonl-'))
  directories.push(dir)
  return dir
}

function nudge({ text }: { text: string }): EventDraft {
  return { type: 'nudge', text, lifetimeSteps: 1 }
}

function contextLoaded({ key }: { key: string }): EventDraft {
  return { type: 'context-loaded', slot: 'instructions', key, content: `content of ${key}` }
}

function openLog({ home }: { home: string }): { log: JsonlEventLog; ids: CountingIds } {
  const ids = new CountingIds('spec')
  return { log: new JsonlEventLog(home, new SessionRegistry(home), new SteppingClock(), ids), ids }
}

const mainThread = toThreadId('brn_main')

describe('JsonlEventLog', () => {
  it('appends and reads back with contiguous seqs across batches', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })

    await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'one' })] })
    const stamped = await log.append({
      threadId: mainThread,
      runId: ids.nextRunId(),
      drafts: [nudge({ text: 'two' }), nudge({ text: 'three' })],
    })

    expect(stamped.map((event) => event.seq)).toEqual([2, 3])
    expect(await log.head({ threadId: mainThread })).toBe(3)
    const read = await log.read({ threadId: mainThread })
    expect(read.map((event) => event.type)).toEqual(['nudge', 'nudge', 'nudge'])
  })

  it('reuses a matching context-loaded event instead of appending a duplicate', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })

    const first = await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [contextLoaded({ key: 'claude-md' })] })
    const second = await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [contextLoaded({ key: 'claude-md' })] })

    expect(second[0]?.id).toBe(first[0]?.id)
    expect(await log.head({ threadId: mainThread })).toBe(1)
  })

  it('replace rewrites the log with fresh ids and seqs from 1', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })

    const original = await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'old' })] })
    const replaced = await log.replace({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'new-a' }), nudge({ text: 'new-b' })] })

    expect(replaced.map((event) => event.seq)).toEqual([1, 2])
    expect(replaced[0]?.id).not.toBe(original[0]?.id)
    expect((await log.read({ threadId: mainThread })).map((event) => (event.type === 'nudge' ? event.text : event.type))).toEqual(['new-a', 'new-b'])
  })

  it('serializes concurrent appends so seqs never collide', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })

    const [a, b] = await Promise.all([
      log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'a1' }), nudge({ text: 'a2' })] }),
      log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'b1' })] }),
    ])

    const seqs = [...a, ...b].map((event) => event.seq).sort((x, y) => x - y)
    expect(seqs).toEqual([1, 2, 3])
    expect((await log.read({ threadId: mainThread })).map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('reads a thread whose meta file is corrupt, taking head from the log', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'one' }), nudge({ text: 'two' })] })

    const sessionDir = sessionDirectory({ home, sessionId: mainThread })
    writeFileSync(threadMetaFile({ sessionDir, threadId: mainThread }), Buffer.alloc(64))

    const fresh = openLog({ home })
    expect((await fresh.log.read({ threadId: mainThread })).map((event) => event.seq)).toEqual([1, 2])
    expect(await fresh.log.head({ threadId: mainThread })).toBe(2)
  })

  it('skips a corrupt meta during the thread index scan', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'one' })] })

    const sessionDir = sessionDirectory({ home, sessionId: mainThread })
    writeFileSync(threadMetaFile({ sessionDir, threadId: mainThread }), '{ truncated')

    const registry = new SessionRegistry(home)
    await expect(registry.sessionDirOf({ threadId: mainThread })).resolves.toBeUndefined()
    await expect(registry.sessionDirFor({ threadId: mainThread })).resolves.toBe(sessionDir)
  })

  it('composes a reference fork: parent prefix plus own events', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })

    await log.append({
      threadId: mainThread,
      runId: ids.nextRunId(),
      drafts: [nudge({ text: 'p1' }), nudge({ text: 'p2' }), nudge({ text: 'p3' }), nudge({ text: 'p4' })],
    })

    const forkThread: ThreadId = toThreadId('brn_fork')
    const forkDir = sessionDirectory({ home, sessionId: forkThread })
    await writeMeta({
      file: threadMetaFile({ sessionDir: forkDir, threadId: forkThread }),
      meta: {
        ...newThreadMeta({ id: forkThread, at: '2026-09-23T00:00:00.000Z' }),
        head: 2,
        parentThreadId: mainThread,
        forkSeq: 2,
        forkMode: EForkMode.Reference,
      },
    })

    const stamped = await log.append({ threadId: forkThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'f1' })] })
    expect(stamped[0]?.seq).toBe(3)

    const read = await log.read({ threadId: forkThread })
    expect(read.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(read.map((event) => (event.type === 'nudge' ? event.text : event.type))).toEqual(['p1', 'p2', 'f1'])
  })

  it('replace on a reference fork keeps numbering above the fork point', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })

    await log.append({
      threadId: mainThread,
      runId: ids.nextRunId(),
      drafts: [nudge({ text: 'p1' }), nudge({ text: 'p2' })],
    })

    const forkThread: ThreadId = toThreadId('brn_fork')
    const forkDir = sessionDirectory({ home, sessionId: forkThread })
    await writeMeta({
      file: threadMetaFile({ sessionDir: forkDir, threadId: forkThread }),
      meta: {
        ...newThreadMeta({ id: forkThread, at: '2026-09-23T00:00:00.000Z' }),
        head: 2,
        parentThreadId: mainThread,
        forkSeq: 2,
        forkMode: EForkMode.Reference,
      },
    })

    const replaced = await log.replace({
      threadId: forkThread,
      runId: ids.nextRunId(),
      drafts: [nudge({ text: 'summary' })],
    })
    expect(replaced[0]?.seq).toBe(3)
    expect(await log.head({ threadId: forkThread })).toBe(3)

    const read = await log.read({ threadId: forkThread })
    expect(read.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('recovers from a truncated tail on reopen', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'one' })] })

    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: mainThread }), threadId: mainThread })
    appendFileSync(file, '{"v":1,"id":"evt_partial","seq":2,"thre')

    const reopened = openLog({ home })
    const read = await reopened.log.read({ threadId: mainThread })
    expect(read.map((event) => (event.type === 'nudge' ? event.text : event.type))).toEqual(['one'])
    expect(await reopened.log.head({ threadId: mainThread })).toBe(1)
  })

  it('welds a torn tail away before appending, so the next batch starts on its own line', async () => {
    const home = await tempHome()
    const { log, ids } = openLog({ home })
    await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'one' })] })

    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: mainThread }), threadId: mainThread })
    appendFileSync(file, '{"v":1,"id":"evt_partial","seq":2,"thre')

    const stamped = await log.append({ threadId: mainThread, runId: ids.nextRunId(), drafts: [nudge({ text: 'two' })] })
    const readBack = await log.read({ threadId: mainThread })

    expect(stamped.map((event) => event.seq)).toEqual([2])
    expect(readBack.map((event) => (event.type === 'nudge' ? event.text : event.type))).toEqual(['one', 'two'])
    expect(await log.head({ threadId: mainThread })).toBe(2)
  })

  it('re-reads the log when another writer touched it, instead of reusing a stale head', async () => {
    const home = await tempHome()
    const first = openLog({ home })
    await first.log.append({ threadId: mainThread, runId: first.ids.nextRunId(), drafts: [nudge({ text: 'one' })] })

    const outsider = openLog({ home })
    await outsider.log.append({ threadId: mainThread, runId: outsider.ids.nextRunId(), drafts: [nudge({ text: 'outside' })] })

    const stamped = await first.log.append({ threadId: mainThread, runId: first.ids.nextRunId(), drafts: [nudge({ text: 'two' })] })

    expect(stamped.map((event) => event.seq)).toEqual([3])
    const readBack = await first.log.read({ threadId: mainThread })
    expect(readBack.map((event) => (event.type === 'nudge' ? event.text : event.type))).toEqual(['one', 'outside', 'two'])
    expect(await first.log.head({ threadId: mainThread })).toBe(3)
  })
})
