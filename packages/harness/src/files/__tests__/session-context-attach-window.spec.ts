import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'

import { sessionDirectory } from '../../store/sessions/paths'
import { createSessionContextReader } from '../session-context'
import { ATTACH_RECHECK_DELAY_MS, watchContextDirectory, type WatchPath } from '../watch-context-directory'

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const settle = () => Bun.sleep(ATTACH_RECHECK_DELAY_MS * 3)

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-attach-window-'))
  homes.push(home)
  const sessionId = toThreadId('root')
  const sessionDir = sessionDirectory({ home, sessionId })
  return { home, sessionId, sessionDir }
}

function silentWatch() {
  const attached: { path: string; closed: boolean; deliver: (name: string) => void }[] = []
  const watchPath: WatchPath = (path, _options, listener) => {
    if (!existsSync(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    const entry = { path, closed: false, deliver: (name: string) => listener('rename', name) }
    attached.push(entry)
    return { on: () => undefined, close: () => { entry.closed = true } }
  }
  return { attached, watchPath }
}

function counter() {
  let count = 0
  return { notify: () => { count += 1 }, get count() { return count } }
}

describe('window between subscribe and attach', () => {
  it('notifies for a file created before the watch attached, and lists it', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    const reader = createSessionContextReader({ home, threadId: sessionId, watchPath: silentWatch().watchPath })
    let resolveChange: () => void = () => {}
    const change = new Promise<void>((resolve) => { resolveChange = resolve })
    const stop = reader.subscribe(resolveChange)
    try {
      mkdirSync(join(sessionDir, 'context'), { recursive: true })
      writeFileSync(join(sessionDir, 'context', 'notes.md'), 'new note')
      await change
      expect(await reader.list()).toEqual([{ name: 'notes.md', isDirectory: false }])
    } finally { stop() }
  }, 5000)

  it('notifies once at attach for a context modified since the subscribe', async () => {
    const { sessionDir } = await fixture()
    mkdirSync(join(sessionDir, 'context'), { recursive: true })
    writeFileSync(join(sessionDir, 'context', 'notes.md'), 'note')
    const { watchPath } = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({ sessionDir, onChange: seen.notify, changedSince: Date.now() - 1000, watchPath })
    await settle()
    stop()
    expect(seen.count).toBe(1)
  })

  it('stays silent for context that was already there before the subscribe', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    await mkdir(join(sessionDir, 'context'), { recursive: true })
    await writeFile(join(sessionDir, 'context', 'notes.md'), 'existing')
    await settle()
    const reader = createSessionContextReader({ home, threadId: sessionId })
    const seen = counter()
    const stop = reader.subscribe(seen.notify)
    await settle()
    stop()
    expect(seen.count).toBe(0)
  })
})

describe('native watch startup gap', () => {
  it('notices a change whose event the watch dropped', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const { attached, watchPath } = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({ sessionDir, onChange: seen.notify, watchPath })
    try {
      expect(attached.map((entry) => entry.path)).toEqual([sessionDir])
      await mkdir(join(sessionDir, 'context'))
      await writeFile(join(sessionDir, 'context', 'notes.md'), 'new note')
      await settle()
      expect(seen.count).toBe(1)
    } finally { stop() }
  })

  it('covers the replacement watcher when the ancestor watch hands over, without double notifying', async () => {
    const { home, sessionDir } = await fixture()
    const sessions = join(home, 'sessions')
    await mkdir(sessions, { recursive: true })
    const { attached, watchPath } = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({ sessionDir, onChange: seen.notify, watchPath })
    try {
      expect(attached.map((entry) => entry.path)).toEqual([sessions])
      await mkdir(sessionDir)
      attached[0]?.deliver('root')
      expect(seen.count).toBe(1)
      expect(attached.map((entry) => [entry.path, entry.closed])).toEqual([[sessions, true], [sessionDir, false]])
      await mkdir(join(sessionDir, 'context'))
      await writeFile(join(sessionDir, 'context', 'notes.md'), 'new note')
      await settle()
      expect(seen.count).toBe(2)
    } finally { stop() }
  })

  it('does not notify again when the watch delivered the change itself', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const { attached, watchPath } = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({ sessionDir, onChange: seen.notify, watchPath })
    try {
      await mkdir(join(sessionDir, 'context'))
      attached[0]?.deliver('context')
      await settle()
      expect(seen.count).toBe(1)
    } finally { stop() }
  })

  it('stays silent when nothing changes after attaching', async () => {
    const { home, sessionDir } = await fixture()
    await mkdir(join(sessionDir, 'context'), { recursive: true })
    await writeFile(join(sessionDir, 'context', 'notes.md'), 'existing')
    for (const target of [sessionDir, join(home, 'sessions', 'absent', 'deeper')]) {
      const { watchPath } = silentWatch()
      const seen = counter()
      const stop = watchContextDirectory({ sessionDir: target, onChange: seen.notify, watchPath })
      await settle()
      stop()
      expect(seen.count).toBe(0)
    }
  })

  it('cancels the pending re-check on stop', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const { watchPath } = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({ sessionDir, onChange: seen.notify, watchPath })
    stop()
    await mkdir(join(sessionDir, 'context'))
    await settle()
    expect(seen.count).toBe(0)
  })
})
