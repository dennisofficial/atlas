import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { createIsolatedContainer } from '../../container/injection'
import { ThreadStorePort, type ThreadSummary } from '../../store/thread-store'
import { startTimeOf } from '../../workspace/process-identity'
import { listWorktrees, lockWorktree } from '../../workspace/worktrees'
import { worktreeLockToken } from '@dltech/atlas-core'
import { claimOpenedWorktree } from '../worktree-claims'
import { recordingNotices } from './fakes'

const made: string[] = []

const scratch = async (): Promise<string> => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'atlas-claim-skip-')))
  made.push(path)
  return path
}

const git = async (args: readonly string[], cwd: string): Promise<void> => {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' })
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}`)
}

const repo = async (): Promise<string> => {
  const root = await scratch()
  await git(['init', '-b', 'main'], root)
  await git(['config', 'user.email', 'test@example.com'], root)
  await git(['config', 'user.name', 'Test'], root)
  await Bun.write(join(root, 'README.md'), 'hello')
  await git(['add', '.'], root)
  await git(['commit', '-m', 'initial'], root)
  return root
}

const worktree = async ({ root, name, branch }: { root: string; name: string; branch: string }) => {
  const tree = join(root, name)
  await git(['worktree', 'add', '-b', branch, tree], root)
  return tree
}

const isLocked = async ({ root, path }: { root: string; path: string }): Promise<boolean> => {
  const listing = await listWorktrees({ cwd: root })
  if (!listing.ok) throw new Error('could not list worktrees')
  return listing.worktrees.find((one) => one.path === path)?.isLocked ?? false
}

const threadSummary = (args: {
  id: ThreadId
  workspace?: string | null
  spawnedBy?: ThreadId | undefined
}): ThreadSummary => ({
  id: args.id,
  head: 1,
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
  workspace: args.workspace ?? null,
  repo: null,
  ...(args.spawnedBy === undefined
    ? {}
    : { agent: { spawnedBy: args.spawnedBy, type: 'teammate' } }),
})

class StubThreads extends ThreadStorePort {
  private readonly all: readonly ThreadSummary[]

  constructor(all: readonly ThreadSummary[]) {
    super()
    this.all = all
  }

  override async find(args: { threadId: ThreadId }): Promise<ThreadSummary | undefined> {
    return this.all.find((one) => one.id === args.threadId)
  }

  override async create(): Promise<ThreadSummary> {
    throw new Error('not needed')
  }
  override async createWithFirstEvents(): Promise<never> {
    throw new Error('not needed')
  }
  override async spawned(): Promise<readonly ThreadSummary[]> {
    throw new Error('not needed')
  }
  override async mostRecent(): Promise<ThreadSummary | undefined> {
    throw new Error('not needed')
  }
  override async list(): Promise<readonly ThreadSummary[]> {
    throw new Error('not needed')
  }
  override async findNamed(): Promise<ThreadSummary | undefined> {
    throw new Error('not needed')
  }
  override async rename(): Promise<void> {
    throw new Error('not needed')
  }
  override async chooseModel(): Promise<void> {
    throw new Error('not needed')
  }
  override async chooseExecutionLocation(): Promise<void> {
    throw new Error('not needed')
  }
  override async adopt(): Promise<void> {
    throw new Error('not needed')
  }
  override async rewind(): Promise<void> {
    throw new Error('not needed')
  }
  override async compact(): Promise<number> {
    throw new Error('not needed')
  }
  override async summarise(): Promise<number> {
    throw new Error('not needed')
  }
  override async fork(): Promise<ThreadSummary> {
    throw new Error('not needed')
  }
}

afterAll(async () => {
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })))
})

describe('claiming the worktree of an opened teammate', () => {
  it("claims nothing while the teammate still sits in its spawner's worktree", async () => {
    const root = await repo()
    const tree = await worktree({ root, name: 'spawner-tree', branch: 'topic' })
    const spawnerId = toThreadId('thread-spawner')
    const teammateId = toThreadId('thread-teammate')
    const threads = new StubThreads([
      threadSummary({ id: spawnerId, workspace: tree }),
      threadSummary({ id: teammateId, spawnedBy: spawnerId }),
    ])
    const notices = recordingNotices()

    await claimOpenedWorktree({
      container: createIsolatedContainer(),
      threads,
      threadId: teammateId,
      projectDirectory: tree,
      notice: notices.port,
    })

    expect(await isLocked({ root, path: tree })).toBe(false)
    expect(notices.posts).toHaveLength(0)
  })

  it('claims once the teammate has moved into its own worktree', async () => {
    const root = await repo()
    const spawnerTree = await worktree({ root, name: 'spawner-tree', branch: 'topic' })
    const ownTree = await worktree({ root, name: 'own-tree', branch: 'own' })
    const spawnerId = toThreadId('thread-spawner')
    const teammateId = toThreadId('thread-teammate')
    const threads = new StubThreads([
      threadSummary({ id: spawnerId, workspace: spawnerTree }),
      threadSummary({ id: teammateId, spawnedBy: spawnerId }),
    ])
    const notices = recordingNotices()

    await claimOpenedWorktree({
      container: createIsolatedContainer(),
      threads,
      threadId: teammateId,
      projectDirectory: ownTree,
      notice: notices.port,
    })

    expect(await isLocked({ root, path: ownTree })).toBe(true)
    expect(notices.posts).toHaveLength(0)
  })

  it('claims for a thread that was never spawned by another thread', async () => {
    const root = await repo()
    const tree = await worktree({ root, name: 'main-tree', branch: 'topic' })
    const mainId = toThreadId('thread-main')
    const threads = new StubThreads([threadSummary({ id: mainId })])
    const notices = recordingNotices()

    await claimOpenedWorktree({
      container: createIsolatedContainer(),
      threads,
      threadId: mainId,
      projectDirectory: tree,
      notice: notices.port,
    })

    expect(await isLocked({ root, path: tree })).toBe(true)
  })

  it('says a held worktree is a guest only once per directory', async () => {
    const root = await repo()
    const tree = await worktree({ root, name: 'taken', branch: 'theirs' })
    const other = Bun.spawn(['sleep', '30'], { stdout: 'ignore', stderr: 'ignore' })
    try {
      await lockWorktree({
        cwd: root,
        path: tree,
        reason: worktreeLockToken({
          label: 'thread br_other',
          identity: { pid: other.pid, start: await startTimeOf({ pid: other.pid }) },
        }),
      })
      const mainId = toThreadId('thread-main')
      const threads = new StubThreads([threadSummary({ id: mainId })])
      const notices = recordingNotices()

      for (let open = 0; open < 2; open++) {
        await claimOpenedWorktree({
          container: createIsolatedContainer(),
          threads,
          threadId: mainId,
          projectDirectory: tree,
          notice: notices.port,
        })
      }

      expect(notices.posts).toHaveLength(1)
      expect(notices.posts[0]?.text).toContain('guest')
    } finally {
      other.kill()
      await other.exited
    }
  })
})
