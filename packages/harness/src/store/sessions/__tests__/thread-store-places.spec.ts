import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EForkMode, EWorktreeExit, type EventDraft } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, sessionMetaSchema } from '../meta'
import { sessionDirectory, sessionMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-thread-places-'))
  directories.push(dir)
  return dir
}

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const entered = (path: string, branch: string): EventDraft => ({ type: 'worktree-entered', path, branch })
const exited = (path: string): EventDraft => ({ type: 'worktree-exited', path, action: EWorktreeExit.Keep })
const linked = ({ number, branch }: { number: number; branch: string }): EventDraft => ({
  type: 'pull-request-linked',
  number,
  url: `https://github.com/acme/app/pull/${number}`,
  repo: 'github.com/acme/app',
  branch,
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

describe('the worktree a listed thread is standing in', () => {
  it('is nothing for a thread that never moved, and the last entered worktree once it has', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const unmoved = await threads.create({ title: 'unmoved', workspace: '/here' })
    await log.append({ threadId: unmoved.id, runId: ids.nextRunId(), drafts: [said('hello')] })

    expect((await threads.list({ project: '/here' }))[0]?.worktree).toBeUndefined()

    await log.append({
      threadId: unmoved.id,
      runId: ids.nextRunId(),
      drafts: [entered('/here/.worktrees/fix-a1b2', 'dennis/fix-a1b2')],
    })

    expect((await threads.list({ project: '/here' }))[0]?.worktree).toEqual({
      path: '/here/.worktrees/fix-a1b2',
      branch: 'dennis/fix-a1b2',
    })
  })

  it('is nothing once the thread leaves the worktree again', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [entered('/here/.worktrees/fix-a1b2', 'dennis/fix-a1b2'), exited('/here/.worktrees/fix-a1b2')],
    })

    expect((await threads.list({ project: '/here' }))[0]?.worktree).toBeUndefined()
  })

  it('is inherited by a reference fork up to the fork point, and no further', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const source = await threads.create({ workspace: '/here' })
    await log.append({
      threadId: source.id,
      runId: ids.nextRunId(),
      drafts: [said('hello'), entered('/here/.worktrees/fix-a1b2', 'dennis/fix-a1b2')],
    })
    const forked = await threads.fork({ from: source.id, seq: 1, mode: EForkMode.Reference })
    const later = await threads.fork({ from: source.id, seq: 2, mode: EForkMode.Reference })

    const listed = await threads.list({ project: '/here' })
    expect(listed.find((row) => row.id === forked.id)?.worktree).toBeUndefined()
    expect(listed.find((row) => row.id === later.id)?.worktree?.branch).toBe('dennis/fix-a1b2')

    await log.append({
      threadId: source.id,
      runId: ids.nextRunId(),
      drafts: [entered('/here/.worktrees/fix-c3d4', 'dennis/fix-c3d4')],
    })

    const relisted = await threads.list({ project: '/here' })
    expect(relisted.find((row) => row.id === later.id)?.worktree?.branch).toBe('dennis/fix-a1b2')
  })

  it('stands where a copy fork stands, whose copied log carries the move with it', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const source = await threads.create({ workspace: '/here' })
    await log.append({
      threadId: source.id,
      runId: ids.nextRunId(),
      drafts: [said('hello'), entered('/here/.worktrees/fix-a1b2', 'dennis/fix-a1b2')],
    })
    const copied = await threads.fork({ from: source.id, seq: 2, mode: EForkMode.Copy })

    const listed = await threads.list({ project: '/here' })
    expect(listed.find((row) => row.id === copied.id)?.worktree?.branch).toBe('dennis/fix-a1b2')
  })
})

describe('the pull requests a listed thread is linked to', () => {
  it('folds the links oldest first, refreshing a repeat in place', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [
        linked({ number: 401, branch: 'dennis/first' }),
        linked({ number: 412, branch: 'dennis/second' }),
        linked({ number: 401, branch: 'dennis/first-rebased' }),
      ],
    })

    const listed = (await threads.list({ project: '/here' }))[0]
    expect(listed?.pullRequests?.map((pr) => pr.number)).toEqual([401, 412])
    expect(listed?.pullRequests?.[0]?.branch).toBe('dennis/first-rebased')
  })

  it('is inherited by a reference fork up to the fork point', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const source = await threads.create({ workspace: '/here' })
    await log.append({
      threadId: source.id,
      runId: ids.nextRunId(),
      drafts: [said('hello'), linked({ number: 401, branch: 'dennis/first' })],
    })
    const forked = await threads.fork({ from: source.id, seq: 2, mode: EForkMode.Reference })
    await log.append({
      threadId: source.id,
      runId: ids.nextRunId(),
      drafts: [linked({ number: 412, branch: 'dennis/second' })],
    })

    const listed = await threads.list({ project: '/here' })
    expect(listed.find((row) => row.id === forked.id)?.pullRequests?.map((pr) => pr.number)).toEqual([401])
    expect(listed.find((row) => row.id === source.id)?.pullRequests?.map((pr) => pr.number)).toEqual([401, 412])
  })

  it('refreshes the session meta’s derived caches on list', async () => {
    const home = await tempHome()
    const { log, threads, ids } = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })
    await log.append({
      threadId: thread.id,
      runId: ids.nextRunId(),
      drafts: [entered('/here/.worktrees/fix-a1b2', 'dennis/fix-a1b2'), linked({ number: 401, branch: 'dennis/fix' })],
    })

    await threads.list({ project: '/here' })

    const sessionDir = sessionDirectory({ home, sessionId: thread.id })
    const session = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
    expect(session?.worktree).toBe('/here/.worktrees/fix-a1b2')
    expect(session?.pullRequests).toEqual([401])
    expect(session?.updatedAt).toBe((await threads.find({ threadId: thread.id }))?.updatedAt ?? '')
  })
})
