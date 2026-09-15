import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import {
  applyDirectoryMove,
  cdTargetOf,
  directoryRefusal,
  moveTowards,
  type MovePorts,
} from '../directory-move'
import { fakeEventLog, fakeIds, fakeThreadStore } from './fake-backend'

const HOME = process.env.HOME ?? '/home/nobody'

describe('where a /cd argument points', () => {
  it('takes an absolute path as it is', () => {
    expect(cdTargetOf({ argument: '/srv/elsewhere', current: '/work/atlas' })).toBe('/srv/elsewhere')
  })

  it('resolves a relative path against the current directory, not the launch one', () => {
    expect(cdTargetOf({ argument: '../sibling', current: '/work/atlas' })).toBe('/work/sibling')
    expect(cdTargetOf({ argument: 'packages/core', current: '/work/atlas' })).toBe(
      '/work/atlas/packages/core',
    )
  })

  it('expands a leading tilde against the home directory', () => {
    expect(cdTargetOf({ argument: '~/dev/atlas', current: '/work/atlas' })).toBe(
      resolve(HOME, 'dev/atlas'),
    )
  })

  it('trims the argument before reading it', () => {
    expect(cdTargetOf({ argument: '  /srv/elsewhere  ', current: '/work/atlas' })).toBe(
      '/srv/elsewhere',
    )
  })
})

describe('a /cd target on disk', () => {
  const held: string[] = []

  afterEach(async () => {
    await Promise.all(held.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  const make = async (): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-cd-'))
    held.push(directory)
    return realpath(directory)
  }

  it('accepts a directory that exists', async () => {
    expect(directoryRefusal(await make())).toBeNull()
  })

  it('refuses one that is missing', async () => {
    const refusal = directoryRefusal(join(await make(), 'never-made'))
    expect(refusal).toContain('no such directory')
  })

  it('refuses a file', async () => {
    const root = await make()
    const file = join(root, 'a-file.ts')
    await writeFile(file, 'export {}\n')
    expect(directoryRefusal(file)).toContain('not a directory')
  })

  it('reads a plain directory as its own workspace with no repo', async () => {
    const root = await make()
    const move = await moveTowards({ path: root })
    expect(move).toEqual({ path: root, workspace: root, repo: null })
  })

  it('attributes a subdirectory of a git repository to the repository', async () => {
    const root = await make()
    const nested = join(root, 'packages', 'core')
    await mkdir(nested, { recursive: true })
    const init = Bun.spawn(['git', 'init'], { cwd: root, stdout: 'ignore', stderr: 'ignore' })
    expect(await init.exited).toBe(0)

    const move = await moveTowards({ path: nested })
    expect(move.path).toBe(nested)
    expect(move.workspace).toBe(root)
    expect(move.repo).toBe(root)
  })
})

describe('moving a started conversation', () => {
  const threadId = toThreadId('thread-1')
  const move = { path: '/srv/elsewhere', workspace: '/srv/elsewhere', repo: null }

  const ports = () => {
    const log = fakeEventLog()
    const threads = fakeThreadStore({ existing: [threadId], log, workspace: '/work/atlas' })
    const opened: string[] = []
    const app: MovePorts = {
      log,
      threads,
      ids: fakeIds(),
      threadOpened: async ({ projectDirectory }) => {
        opened.push(projectDirectory)
      },
    }
    return { app, log, threads, opened }
  }

  it('records the move, re-attributes the thread and re-announces the directory', async () => {
    const { app, log, threads, opened } = ports()

    await applyDirectoryMove({ app, threadId, move, activeWorktree: null })

    expect(log.peek({ threadId }).map((event) => event.type)).toEqual(['directory-changed'])
    expect(log.peek({ threadId })[0]).toMatchObject({ path: '/srv/elsewhere' })
    expect(opened).toEqual(['/srv/elsewhere'])

    const listed = await threads.find({ threadId })
    expect(listed?.workspace).toBe('/srv/elsewhere')
    expect(listed?.repo).toBeNull()
  })

  it('completes while leaving a worktree whose lock was never taken', async () => {
    const { app, log } = ports()
    const activeWorktree = {
      path: '/work/atlas/.atlas/worktrees/x',
      branch: 'dennis/x',
      base: undefined,
      adopted: false,
    }

    await applyDirectoryMove({ app, threadId, move, activeWorktree })

    expect(log.peek({ threadId })[0]).toMatchObject({ type: 'directory-changed' })
  })
})
