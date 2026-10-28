import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EWorktreeExit, toThreadId, type Event } from '@dltech/atlas-core'
import { EChangeScope, EChangeStatus } from '@dltech/atlas-wire'

import { FileBrowser } from '../../files/file-browser'
import { runGit } from '../../workspace/run-git'
import { threadPanels } from '../thread-panels'

const threadId = toThreadId('thread-panels')
let repo = ''
let worktree = ''

const git = async (cwd: string, ...args: string[]) => {
  const run = await runGit({
    args: ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    cwd,
  })
  if (!run.ok) throw new Error(run.stderr)
}

const eventOf = (body: Record<string, unknown>, seq: number): Event =>
  ({
    id: `ev-${seq}`,
    threadId,
    seq,
    runId: 'run-1',
    depth: 0,
    at: '2026-10-28T00:00:00.000Z',
    ...body,
  }) as Event

const panelsFor = (events: Event[]) =>
  threadPanels({
    threadId,
    log: { readOwn: async () => events },
    threads: { find: async () => undefined },
    launchDirectory: repo,
    files: new FileBrowser({ root: repo }),
  })

const changedPaths = async (events: Event[]) => {
  const reply = await panelsFor(events).changes.read({ scope: EChangeScope.All })
  return reply.files.map((file) => [file.path, file.status])
}

const listedNames = async (events: Event[]) =>
  (await panelsFor(events).files.list('')).map((entry) => entry.name)

beforeEach(async () => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-panels-')))
  await git(repo, 'init', '-q', '-b', 'main')
  mkdirSync(join(repo, '.atlas', 'worktrees'), { recursive: true })
  writeFileSync(join(repo, '.atlas', 'worktrees', '.gitignore'), '*\n')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  await git(repo, 'add', 'README.md')
  await git(repo, 'commit', '-q', '-m', 'first')
  worktree = join(repo, '.atlas', 'worktrees', 'web-render-test')
  await git(repo, 'worktree', 'add', '-q', worktree, '-b', 'dennis/web-render-test')
  writeFileSync(join(worktree, 'README.md'), 'hello\nmore\nlines\n')
  writeFileSync(join(worktree, 'scratch-render-test.md'), 'scratch\n')
})

afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('threadPanels', () => {
  it('reads changes and files from the worktree the thread entered', async () => {
    const events = [eventOf({ type: 'worktree-entered', path: worktree, branch: 'b' }, 1)]

    expect(await changedPaths(events)).toEqual([
      ['README.md', EChangeStatus.Modified],
      ['scratch-render-test.md', EChangeStatus.Added],
    ])
    expect(await listedNames(events)).toContain('scratch-render-test.md')
  })

  it('reads the launch checkout before entering and after exiting', async () => {
    writeFileSync(join(repo, 'main-only.md'), 'main\n')
    const exited = [
      eventOf({ type: 'worktree-entered', path: worktree, branch: 'b' }, 1),
      eventOf({ type: 'worktree-exited', path: worktree, action: EWorktreeExit.Keep }, 2),
    ]

    for (const events of [[], exited]) {
      expect(await changedPaths(events)).toEqual([['main-only.md', EChangeStatus.Added]])
      expect(await listedNames(events)).not.toContain('scratch-render-test.md')
    }
  })
})
