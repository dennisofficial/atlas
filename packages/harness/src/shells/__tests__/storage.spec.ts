import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { CountingIds, SteppingClock } from '../../store/__tests__/harness'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { sessionDirectory, sessionLockFile, threadDataDirectory, threadMetaFile } from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'
import { toShellId } from '../shell-id'
import { ShellStorage, UnknownShellThread, randomShellId, shellFiles } from '../storage'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-shell-storage-'))
  homes.push(home)
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  const threads = new JsonlThreadStore(home, registry, clock, ids, log)
  return { home, threads, storage: new ShellStorage({ sessions: registry }) }
}

describe('ShellStorage', () => {
  it('creates a private shell directory under the owning thread inside the root session', async () => {
    const { home, threads, storage } = await fixture()
    const main = await threads.create({ title: 'main' })
    const child = await threads.create({ agent: { spawnedBy: main.id, type: 'explore' } })
    const sessionDir = sessionDirectory({ home, sessionId: main.id })

    const shell = await storage.create({ threadId: child.id })

    expect(shell.directory.startsWith(join(threadDataDirectory({ sessionDir, threadId: child.id }), 'shells'))).toBe(true)
    expect((await stat(shell.directory)).mode & 0o777).toBe(0o700)
    expect(shell.output).toBe(join(shell.directory, 'spool.out'))
    expect(shell.sessionDirectory).toBe(sessionDir)
    expect(shell.threadDirectory).toBe(threadDataDirectory({ sessionDir, threadId: child.id }))
    expect(shell.sessionLock).toBe(sessionLockFile({ sessionDir }))
    expect(new Set([shell.output, shell.config, shell.lock, shell.cursor, shell.sessionLock]).size).toBe(5)
    expect((await stat(threadMetaFile({ sessionDir, threadId: child.id }))).isFile()).toBe(true)
  })

  it('never reuses an id that already has a directory', async () => {
    const { threads, storage: real } = await fixture()
    const main = await threads.create({ title: 'main' })
    const first = await real.create({ threadId: main.id })
    const ids = [first.shellId, toShellId('shell_fresh')]
    const sessions = { sessionDirOf: async () => first.directory.split('/threads/')[0] }
    const storage = new ShellStorage({ sessions, newId: () => ids.shift() ?? randomShellId() })

    const second = await storage.create({ threadId: main.id })

    expect(second.shellId).toBe(toShellId('shell_fresh'))
  })

  it('draws ids that cannot collide with the old bash_N counters', () => {
    const drawn = new Set(Array.from({ length: 200 }, () => randomShellId()))
    expect(drawn.size).toBe(200)
    for (const id of drawn) expect(id).toMatch(/^shell_[0-9a-f]{32}$/)
  })

  it('refuses a thread no session knows instead of inventing a second session', async () => {
    const { home, storage } = await fixture()
    const stranger = toThreadId('stranger')

    await expect(storage.create({ threadId: stranger })).rejects.toBeInstanceOf(UnknownShellThread)
    expect(await stat(sessionDirectory({ home, sessionId: stranger })).catch(() => null)).toBeNull()
  })

  it('rejects shell ids that could escape their directory', () => {
    expect(() => shellFiles({ sessionDir: '/s', threadId: toThreadId('t'), shellId: toShellId('../x') })).toThrow()
  })

  it('locates the files of an existing shell', async () => {
    const { threads, storage } = await fixture()
    const main = await threads.create({ title: 'main' })
    const shell = await storage.create({ threadId: main.id })

    const { shellId, ...files } = shell
    expect(await storage.locate({ threadId: main.id, shellId })).toEqual(files)
  })

  it('refuses to create shells through a symlinked thread directory', async () => {
    const { home, threads, storage } = await fixture()
    const main = await threads.create({ title: 'main' })
    const outside = await mkdtemp(join(tmpdir(), 'atlas-shell-outside-'))
    homes.push(outside)
    await symlink(outside, threadDataDirectory({ sessionDir: sessionDirectory({ home, sessionId: main.id }), threadId: main.id }))

    await expect(storage.create({ threadId: main.id })).rejects.toThrow('must be a plain directory')
  })
})
