import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExecutionLocation, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, sessionMetaSchema, threadMetaSchema } from '../meta'
import { sessionDirectory, sessionMetaFile, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-thread-store-'))
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

describe('JsonlThreadStore.create', () => {
  it('creates a root thread with its session folder and both metas', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })

    const thread = await threads.create({ title: 'refactor the log', workspace: '/here', repo: '/repo' })

    expect(thread.title).toBe('refactor the log')
    expect(thread.head).toBe(0)
    expect(await threads.find({ threadId: thread.id })).toEqual(thread)

    const sessionDir = sessionDirectory({ home, sessionId: thread.id })
    const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
    expect(session).toMatchObject({ format: 1, id: thread.id, title: 'refactor the log', home: 'host' })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: thread.id }), schema: threadMetaSchema })
    expect(meta).toMatchObject({ workspace: '/here', repo: '/repo', spawnerThreadId: null })
  })

  it('finds nothing for a thread that does not exist', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })

    expect(await threads.find({ threadId: toThreadId('nope') })).toBeUndefined()
  })

  it('discovers a thread that only ever appeared in an append, through a fresh registry', async () => {
    const home = await tempHome()
    const first = openStore({ home })
    const threadId = toThreadId('implicit')
    await first.log.append({ threadId, runId: first.ids.nextRunId(), drafts: [said('hello')] })

    const reopened = openStore({ home })
    const found = await reopened.threads.find({ threadId })

    expect(found?.id).toBe(threadId)
    expect(found?.head).toBe(1)
    expect(found?.title).toBeUndefined()
    expect(found?.workspace).toBeNull()
    expect(await reopened.threads.list({ project: '/work' })).toEqual([])
  })
})

describe('JsonlThreadStore field choices', () => {
  it('renames a thread without disturbing its head, and syncs the session meta', async () => {
    const home = await tempHome()
    const { threads, log, ids } = openStore({ home })
    const thread = await threads.create({ title: 'before', workspace: '/here' })
    await log.append({ threadId: thread.id, runId: ids.nextRunId(), drafts: [said('one')] })

    await threads.rename({ threadId: thread.id, title: 'after' })

    expect(await threads.find({ threadId: thread.id })).toMatchObject({ title: 'after', head: 1 })
    const sessionDir = sessionDirectory({ home, sessionId: thread.id })
    const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
    expect(session?.title).toBe('after')
  })

  it('remembers the chosen model without counting it as activity', async () => {
    const home = await tempHome()
    const { threads, log, ids } = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })
    await log.append({ threadId: thread.id, runId: ids.nextRunId(), drafts: [said('hello')] })
    const before = await threads.find({ threadId: thread.id })

    await threads.chooseModel({ threadId: thread.id, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } })

    const after = await threads.find({ threadId: thread.id })
    expect(after?.model).toEqual({ ref: 'anthropic/claude-opus-5', effort: 'high' })
    expect(after?.updatedAt).toBe(before?.updatedAt ?? '')
  })

  it('remembers the chosen execution location', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })

    expect((await threads.find({ threadId: thread.id }))?.executionLocation).toBeUndefined()
    await threads.chooseExecutionLocation({ threadId: thread.id, location: EExecutionLocation.Docker })
    expect((await threads.find({ threadId: thread.id }))?.executionLocation).toBe(EExecutionLocation.Docker)
  })

  it('adopts a thread that carried no workspace, so it lists where it was reopened', async () => {
    const home = await tempHome()
    const { threads, log, ids } = openStore({ home })
    const threadId = toThreadId('unattributed')
    await log.append({ threadId, runId: ids.nextRunId(), drafts: [said('hello')] })

    await threads.adopt({ threadId, workspace: '/here', repo: '/repo' })

    expect((await threads.list({ project: '/here' })).map((row) => row.id)).toEqual([threadId])
    expect((await threads.find({ threadId }))?.repo).toBe('/repo')
  })
})

describe('JsonlThreadStore supervision', () => {
  it('keeps an agent thread inside its spawner’s session folder', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    const spawner = await threads.create({ title: 'main', workspace: '/here' })

    const child = await threads.create({ workspace: '/here', agent: { spawnedBy: spawner.id, type: 'explore' } })

    expect(child.agent).toEqual({ spawnedBy: spawner.id, type: 'explore' })
    const rootDir = sessionDirectory({ home, sessionId: spawner.id })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir: rootDir, threadId: child.id }), schema: threadMetaSchema })
    expect(meta?.spawnerThreadId).toBe(spawner.id)
  })

  it('answers spawned() by scanning the session folder’s thread metas', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    const spawner = await threads.create({ title: 'main', workspace: '/here' })
    const first = await threads.create({ agent: { spawnedBy: spawner.id, type: 'explore' } })
    const second = await threads.create({ agent: { spawnedBy: spawner.id, type: 'builder' } })

    expect((await threads.spawned({ threadId: spawner.id })).map((row) => row.id)).toEqual([first.id, second.id])
    expect(await threads.spawned({ threadId: first.id })).toEqual([])
  })

  it('keeps agent threads out of /resume listings and most-recent', async () => {
    const home = await tempHome()
    const { threads, log, ids } = openStore({ home })
    const root = await threads.create({ title: 'main', workspace: '/here' })
    const child = await threads.create({ workspace: '/here', agent: { spawnedBy: root.id, type: 'explore' } })
    await log.append({ threadId: child.id, runId: ids.nextRunId(), drafts: [said('agent work')] })

    expect((await threads.list({ project: '/here' })).map((row) => row.id)).toEqual([root.id])
    expect((await threads.mostRecent({ project: '/here' }))?.id).toBe(root.id)
  })

  it('sorts a session by any activity in its folder, including an agent’s', async () => {
    const home = await tempHome()
    const { threads, log, ids } = openStore({ home })
    const older = await threads.create({ title: 'older', workspace: '/here' })
    await threads.create({ title: 'newer', workspace: '/here' })
    const child = await threads.create({ agent: { spawnedBy: older.id, type: 'explore' } })
    await log.append({ threadId: child.id, runId: ids.nextRunId(), drafts: [said('agent work')] })

    expect((await threads.list({ project: '/here' })).map((row) => row.title)).toEqual(['older', 'newer'])
  })
})

describe('JsonlThreadStore listing', () => {
  it('has no most recent thread before anything is written', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })

    expect(await threads.mostRecent({ project: '/work' })).toBeUndefined()
  })

  it('answers most recent with the thread touched last, scoped to the project', async () => {
    const home = await tempHome()
    const { threads, log, ids } = openStore({ home })
    const older = await threads.create({ title: 'older', workspace: '/work' })
    await threads.create({ title: 'newer', workspace: '/work' })
    await threads.create({ title: 'elsewhere', workspace: '/other' })
    await log.append({ threadId: older.id, runId: ids.nextRunId(), drafts: [said('touched last')] })

    expect((await threads.mostRecent({ project: '/work' }))?.id).toBe(older.id)
  })

  it('lists the threads of every worktree of a project, most recently touched first', async () => {
    const home = await tempHome()
    const { threads, log, ids } = openStore({ home })
    const onMain = await threads.create({ title: 'on main', workspace: '/repo', repo: '/repo' })
    await threads.create({ title: 'on feature', workspace: '/wt/feature', repo: '/repo' })
    await threads.create({ title: 'theirs', workspace: '/wt/other', repo: '/other' })
    await log.append({ threadId: onMain.id, runId: ids.nextRunId(), drafts: [said('touched last')] })

    expect((await threads.list({ project: '/repo' })).map((row) => row.title)).toEqual(['on main', 'on feature'])
  })

  it('still lists a main-checkout thread that predates repo attribution', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    await threads.create({ title: 'legacy', workspace: '/repo', repo: null })
    await threads.create({ title: 'legacy worktree', workspace: '/wt/old', repo: null })

    expect((await threads.list({ project: '/repo' })).map((row) => row.title)).toEqual(['legacy'])
    expect((await threads.list({ project: '/wt/old' })).map((row) => row.title)).toEqual(['legacy worktree'])
  })

  it('takes no more threads than the limit asked for', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    for (const title of ['one', 'two', 'three']) await threads.create({ title, workspace: '/here' })

    expect(await threads.list({ project: '/here', limit: 2 })).toHaveLength(2)
  })

  it('finds a thread by name however far down the picker’s window it has fallen', async () => {
    const home = await tempHome()
    const { threads } = openStore({ home })
    const target = await threads.create({ title: 'Migrating to prod GHCR binary', workspace: '/here' })
    for (let newer = 0; newer < 50; newer += 1) await threads.create({ title: `newer ${newer}`, workspace: '/here' })

    expect(await threads.list({ project: '/here' })).toHaveLength(50)
    const found = await threads.findNamed({ project: '/here', handle: 'migrating-to-prod-ghcr-binary' })
    expect(found?.id).toBe(target.id)
    expect((await threads.findNamed({ project: '/here', handle: 'migrating to prod ghcr binary' }))?.id).toBe(target.id)
    expect(await threads.findNamed({ project: '/here', handle: 'nobody' })).toBeUndefined()
  })
})
