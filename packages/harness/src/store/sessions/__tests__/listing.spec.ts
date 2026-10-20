import { afterEach, describe, expect, it } from 'bun:test'
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EForkMode, toThreadId, type EventDraft, type LinkedPullRequest } from '@dltech/atlas-core'

import type { ThreadSummary } from '../../thread-store'
import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { listRoots } from '../listing'
import { placesForSegments } from '../session-place-reader'
import { readMetaSync, sessionMetaSchema, type SessionMeta } from '../meta'
import { eventLogFile, sessionDirectory, sessionMetaFile, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-listing-'))
  directories.push(dir)
  return dir
}

function openStore({ home }: { home: string }): {
  registry: SessionRegistry
  log: JsonlEventLog
  threads: JsonlThreadStore
  ids: CountingIds
} {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return {
    registry,
    log,
    threads: new JsonlThreadStore(home, registry, clock, ids, log),
    ids,
  }
}

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const entered = (path: string, branch: string): EventDraft => ({ type: 'worktree-entered', path, branch })


async function stampMetaAt({ home, threadId, at }: { home: string; threadId: string; at: string }): Promise<void> {
  const file = threadMetaFile({ sessionDir: sessionDirectory({ home, sessionId: toThreadId(threadId) }), threadId: toThreadId(threadId) })
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  await writeFile(file, JSON.stringify({ ...parsed, updatedAt: at }, null, 2))
}

describe('listing order', () => {
  it('sorts by the session’s latest activity, including a child thread’s', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const older = await threads.create({ title: 'older', workspace: '/work' })
    const newer = await threads.create({ title: 'newer', workspace: '/work' })
    await log.append({ threadId: older.id, runId: ids.nextRunId(), drafts: [said('old turn')] })
    await log.append({ threadId: newer.id, runId: ids.nextRunId(), drafts: [said('new turn')] })

    await stampMetaAt({ home, threadId: older.id, at: '2026-01-01T00:00:00.000Z' })
    const child = await threads.create({ title: 'child', workspace: '/work', agent: { spawnedBy: older.id, type: 'explorer' } })
    await log.append({ threadId: child.id, runId: ids.nextRunId(), drafts: [said('child just ran')] })

    const rows = await listRoots({ home, project: '/work' })
    expect(rows[0]?.id).toBe(older.id)
    expect(rows[1]?.id).toBe(newer.id)
    expect(rows.some((row) => row.id === child.id)).toBe(false)
  })

  it('moves a root up when a fork’s thread is the freshest thing in its session', async () => {
    const home = await tempHome()
    const { registry, log, threads, ids } = openStore({ home })
    const first = await threads.create({ title: 'first', workspace: '/work' })
    const second = await threads.create({ title: 'second', workspace: '/work' })
    await log.append({ threadId: first.id, runId: ids.nextRunId(), drafts: [said('a')] })
    await log.append({ threadId: second.id, runId: ids.nextRunId(), drafts: [said('b')] })
    await stampMetaAt({ home, threadId: second.id, at: '2026-01-01T00:00:00.000Z' })

    const forked = await threads.fork({ from: second.id, seq: 1, mode: EForkMode.Reference, title: 'second fork' })
    await log.append({ threadId: forked.id, runId: ids.nextRunId(), drafts: [said('fork turn')] })

    const rows = await listRoots({ home, project: '/work' })
    expect(rows.map((row) => row.id)).toEqual([forked.id, first.id, second.id])
  })
})

describe('listing places on a cold registry', () => {
  it('re-derives worktree and pull requests from the event log with no prior list', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const thread = await threads.create({ title: 'cold', workspace: '/work' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [
        said('hello'),
        entered('/work/.wt/cold', 'dennis/cold'),
        {
          type: 'pull-request-linked',
          number: 401,
          url: 'https://github.com/acme/app/pull/401',
          repo: 'github.com/acme/app',
          branch: 'dennis/cold',
        },
      ],
    })

    const [listed] = await listRoots({ home, project: '/work' })
    expect(listed?.worktree).toEqual({ path: '/work/.wt/cold', branch: 'dennis/cold' })
    expect(listed?.pullRequests?.map((pr) => pr.number)).toEqual([401])
  })

  it('finds facts that sit at the head of a giant log, not near its tail', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const thread = await threads.create({ title: 'giant', workspace: '/work' })
    await log.append({ threadId: thread.id, runId: ids.nextRunId(), drafts: [entered('/work/.wt/first', 'dennis/first')] })
    for (let turnIndex = 0; turnIndex < 200; turnIndex += 1) {
      await log.append({
        threadId: thread.id,
        runId: ids.nextRunId(),
        drafts: [said('noise'), { type: 'assistant-said', parts: [{ type: 'text', text: 'x'.repeat(50_000) }] }],
      })
    }

    const [listed] = await listRoots({ home, project: '/work' })
    expect(listed?.worktree).toEqual({ path: '/work/.wt/first', branch: 'dennis/first' })
  })

  it('keeps places out of the registry’s full-log cache: listing a giant session leaves nothing cached', async () => {
    const home = await tempHome()
    const { registry, log, threads, ids } = openStore({ home })
    const thread = await threads.create({ title: 'uncached', workspace: '/work' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [entered('/work/.wt/uncached', 'dennis/uncached')],
    })
    for (let turnIndex = 0; turnIndex < 50; turnIndex += 1) {
      await log.append({
        threadId: thread.id,
        runId: ids.nextRunId(),
        drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'y'.repeat(50_000) }] }],
      })
    }

    await listRoots({ home, project: '/work' })

    const sessionDir = sessionDirectory({ home, sessionId: thread.id })
    expect(registry.handleFor({ sessionDir }).threads.get(thread.id)?.events.length).toBe(51)
    const cold = new SessionRegistry(home)
    expect(cold.handleFor({ sessionDir }).threads.get(thread.id)).toBeUndefined()
  })

  it('picks up an external append to the log between two lists', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const thread = await threads.create({ title: 'moving', workspace: '/work' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [entered('/work/.wt/first', 'dennis/first')],
    })

    expect((await listRoots({ home, project: '/work' }))[0]?.worktree?.branch).toBe('dennis/first')

    const file = eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: thread.id }), threadId: thread.id })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [entered('/work/.wt/second', 'dennis/second')],
    })
    await appendFile(file, '', 'utf8')

    expect((await listRoots({ home, project: '/work' }))[0]?.worktree?.branch).toBe('dennis/second')
  })
})

describe('listing reads', () => {
  it('does not write the session meta or the thread meta on list', async () => {
    const home = await tempHome()
    const { registry, log, threads, ids } = openStore({ home })
    const thread = await threads.create({ title: 'quiet', workspace: '/work' })
    await log.append({ threadId: thread.id, runId: ids.nextRunId(), drafts: [said('hello')] })

    const sessionDir = sessionDirectory({ home, sessionId: thread.id })
    const beforeSession = (await stat(sessionMetaFile({ sessionDir }))).mtimeMs
    const beforeThread = (await stat(threadMetaFile({ sessionDir, threadId: thread.id }))).mtimeMs

    await listRoots({ home, project: '/work' })

    expect((await stat(sessionMetaFile({ sessionDir }))).mtimeMs).toBeLessThanOrEqual(beforeSession)
    expect((await stat(threadMetaFile({ sessionDir, threadId: thread.id }))).mtimeMs).toBeLessThanOrEqual(beforeThread)
  })

  it('keeps the legacy session-meta schema, with the worktree a bare path and pull requests bare numbers', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    const thread = await threads.create({ title: 'legacy', workspace: '/work' })
    const file = sessionMetaFile({ sessionDir: sessionDirectory({ home, sessionId: thread.id }) })
    const meta = readMetaSync({ file, schema: sessionMetaSchema })
    if (meta === undefined) throw new Error('no session meta')
    await writeFile(file, JSON.stringify({ ...meta, worktree: '/work/.wt/old', pullRequests: [401] }, null, 2))

    const parsed = readMetaSync({ file, schema: sessionMetaSchema })
    expect(parsed?.worktree).toBe('/work/.wt/old')
    expect(parsed?.pullRequests).toEqual([401])
  })
})

describe('listing with a progress callback', () => {
  it('emits the basic rows first and re-emits with places as enrichment lands', async () => {
    const home = await tempHome()
    const { registry, log, threads, ids } = openStore({ home })
    const thread = await threads.create({ title: 'progressive', workspace: '/work' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [said('hello'), entered('/work/.wt/progressive', 'dennis/progressive')],
    })

    const emissions: (readonly ThreadSummary[])[] = []
    const rows = await listRoots({
      home,
      project: '/work',
      onUpdate: (next) => emissions.push(next),
    })

    expect(emissions.length).toBeGreaterThan(1)
    expect(emissions[0]?.[0]?.worktree).toBeUndefined()
    expect(emissions.at(-1)?.[0]?.worktree).toEqual({ path: '/work/.wt/progressive', branch: 'dennis/progressive' })
    expect([...rows]).toEqual([...(emissions.at(-1) ?? [])])
  })

  it('still returns a fully enriched listing when no callback is given', async () => {
    const home = await tempHome()
    const { registry, log, threads, ids } = openStore({ home })
    const thread = await threads.create({ title: 'plain', workspace: '/work' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [entered('/work/.wt/plain', 'dennis/plain')],
    })

    const [listed] = await listRoots({ home, project: '/work' })
    expect(listed?.worktree).toEqual({ path: '/work/.wt/plain', branch: 'dennis/plain' })
  })
})

describe('listing selected roots directly', () => {
  it('enriches the selected ids without scanning every session, however deep their history', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const older = await threads.create({ title: 'older', workspace: '/work' })
    await log.append({
      threadId: older.id,
      runId: ids.nextRunId(),
      drafts: [entered('/work/.wt/older', 'dennis/older')],
    })
    await stampMetaAt({ home, threadId: older.id, at: '2026-01-01T00:00:00.000Z' })

    for (let index = 0; index < 60; index += 1) {
      const thread = await threads.create({ title: `noise-${index}`, workspace: '/work' })
      await log.append({ threadId: thread.id, runId: ids.nextRunId(), drafts: [said(`noise ${index}`)] })
    }

    const rows = await listRoots({ home, project: '/work', limit: Number.POSITIVE_INFINITY, enrich: [older.id] })
    expect(rows.map((row) => row.id)).toEqual([older.id])
    expect(rows[0]?.worktree).toEqual({ path: '/work/.wt/older', branch: 'dennis/older' })
  })

  it('skips a selected id that names a child thread or another project', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const parent = await threads.create({ title: 'parent', workspace: '/work' })
    await log.append({ threadId: parent.id, runId: ids.nextRunId(), drafts: [said('hello')] })
    const child = await threads.create({ title: 'child', workspace: '/work', agent: { spawnedBy: parent.id, type: 'explorer' } })
    const elsewhere = await threads.create({ title: 'elsewhere', workspace: '/other' })

    const rows = await listRoots({
      home,
      project: '/work',
      limit: Number.POSITIVE_INFINITY,
      enrich: [child.id, elsewhere.id, parent.id],
    })
    expect(rows.map((row) => row.id)).toEqual([parent.id])
  })
})
