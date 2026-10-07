import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { EWorktreeExit, toThreadId, type Event } from '@dltech/atlas-core'

import { EFileLoad, FileBrowser } from '../file-browser'
import { rebaseMentionReader } from '../rebase-mention-reader'
import { threadMentionFiles } from '../thread-mention-files'

const threadId = toThreadId('thread-mentions')

const tree = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-mention-root-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}

const eventOf = (body: Record<string, unknown>, seq: number): Event =>
  ({ id: `ev-${seq}`, threadId, seq, runId: 'run-1', depth: 0, at: '2026-10-07T00:00:00.000Z', ...body }) as Event

const reading = (args: { events: Event[]; workspace?: string | null }) => ({
  log: { readOwn: async () => args.events },
  threads: {
    find: async () => ({
      id: threadId, head: 0, createdAt: '', updatedAt: '', repo: null, workspace: args.workspace ?? null,
    }),
  },
})

describe('threadMentionFiles', () => {
  it('reads the launch directory until a worktree is entered, then the worktree, then back', async () => {
    const launch = tree({ 'launch-only.txt': 'launch' })
    const worktree = tree({ 'worktree-only.txt': 'tree' })
    const events: Event[] = []
    const { log, threads } = reading({ events })
    const open = () => threadMentionFiles({ threadId, log, threads, launchDirectory: launch })

    expect((await (await open()).list('.')).map((entry) => entry.name)).toEqual(['launch-only.txt'])

    events.push(eventOf({ type: 'worktree-entered', path: worktree, branch: 'b' }, 1))
    const inside = await open()
    expect((await inside.list('.')).map((entry) => entry.name)).toEqual(['worktree-only.txt'])
    expect(await inside.load('worktree-only.txt')).toMatchObject({ type: EFileLoad.Text, content: 'tree' })

    events.push(eventOf({ type: 'worktree-exited', path: worktree, action: EWorktreeExit.Keep }, 2))
    expect((await (await open()).list('.')).map((entry) => entry.name)).toEqual(['launch-only.txt'])
  })

  it('anchors a child at its own workspace rather than the launch directory', async () => {
    const launch = tree({ 'parent.txt': 'p' })
    const childRoot = tree({ 'child.txt': 'c' })
    const { log, threads } = reading({ events: [], workspace: childRoot })

    const files = await threadMentionFiles({ threadId, log, threads, launchDirectory: launch })

    expect((await files.list('.')).map((entry) => entry.name)).toEqual(['child.txt'])
  })

  it('builds a fresh browser each time, so nothing stale survives', async () => {
    const root = tree({ 'a.txt': 'a' })
    const { log, threads } = reading({ events: [] })
    const first = await threadMentionFiles({ threadId, log, threads, launchDirectory: root })
    await first.list('.')
    writeFileSync(join(root, 'b.txt'), 'b')
    const second = await threadMentionFiles({ threadId, log, threads, launchDirectory: root })

    expect((await second.list('.')).map((entry) => entry.name)).toEqual(['a.txt', 'b.txt'])
  })
})

describe('rebaseMentionReader', () => {
  it('moves a local browser to the new root and keeps its restricted reachability', async () => {
    const root = tree({ 'old.txt': 'o' })
    const next = tree({ 'new.txt': 'n' })
    const mount = tree({ 'mounted.txt': 'm' })
    const restricted = new FileBrowser({ root, reachableRoots: () => [root, mount] })

    const moved = rebaseMentionReader({ reader: restricted, root: next })

    expect((await moved.list('.')).map((entry) => entry.name)).toEqual(['new.txt'])
    expect(await moved.exists(join(mount, 'mounted.txt'))).toBe(true)
    expect(await moved.exists(join(root, 'old.txt'))).toBe(false)
    expect(await moved.load(join(root, 'old.txt'))).toMatchObject({ type: EFileLoad.Refused })
  })

  it('keeps an unrestricted browser unrestricted and returns a remote reader unchanged', async () => {
    const next = tree({ 'new.txt': 'n' })
    const open = rebaseMentionReader({ reader: new FileBrowser({ root: '/nowhere' }), root: next })
    expect(await open.exists('new.txt')).toBe(true)

    const remote = { list: async () => [], exists: async () => true, load: async () => { throw new Error('x') }, forget: () => undefined }
    expect(rebaseMentionReader({ reader: remote, root: next })).toBe(remote)
  })
})
