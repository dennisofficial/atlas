import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createSessionContextReader } from '../session-context'
import type { WatchPath } from '../watch-context-directory'
import { cleanupHomes, counter, fixture, manualSchedule, silentWatch } from './attach-window-fixtures'

afterEach(cleanupHomes)

const MAX_ATTACH_TURNS = 500

describe('window between subscribe and attach', () => {
  it('notifies for a file created before the watch attached, then lists it, with no retry', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    const seams = { watchPath: silentWatch().watchPath, schedule: manualSchedule().schedule }
    const reader = createSessionContextReader({ home, threadId: sessionId, watchSeams: seams })
    let resolveChange: () => void = () => {}
    const change = new Promise<void>((resolve) => { resolveChange = resolve })
    const stop = reader.subscribe(resolveChange, { catchUp: true })
    mkdirSync(join(sessionDir, 'context'), { recursive: true })
    writeFileSync(join(sessionDir, 'context', 'notes.md'), 'new note')
    try {
      await change
      expect(await reader.list()).toEqual([{ name: 'notes.md', isDirectory: false }])
    } finally { stop() }
  }, 5000)

  it('notifies once even when the file carries an old timestamp', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    const timers = manualSchedule()
    const reader = createSessionContextReader({
      home, threadId: sessionId, watchSeams: { watchPath: silentWatch().watchPath, schedule: timers.schedule },
    })
    const seen = counter()
    const stop = reader.subscribe(seen.notify, { catchUp: true })
    const file = join(sessionDir, 'context', 'notes.md')
    mkdirSync(join(sessionDir, 'context'), { recursive: true })
    writeFileSync(file, 'old')
    const longAgo = new Date('2000-01-01T00:00:00Z')
    utimesSync(file, longAgo, longAgo)
    expect(statSync(file).mtimeMs).toBeLessThan(Date.now() - 365 * 24 * 60 * 60 * 1000)
    await seen.first
    await timers.flush()
    stop()
    expect(seen.count).toBe(1)
    expect(await reader.list()).toEqual([{ name: 'notes.md', isDirectory: false }])
  })
})

describe('steady state', () => {
  it('yields exactly one catch-up notification, then stays silent through the re-check', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    await mkdir(join(sessionDir, 'context'), { recursive: true })
    await writeFile(join(sessionDir, 'context', 'notes.md'), 'existing')
    const timers = manualSchedule()
    const reader = createSessionContextReader({
      home, threadId: sessionId, watchSeams: { watchPath: silentWatch().watchPath, schedule: timers.schedule },
    })
    const seen = counter()
    const stop = reader.subscribe(seen.notify, { catchUp: true })
    await seen.first
    expect(seen.count).toBe(1)
    expect(timers.tasks).toHaveLength(1)
    await timers.flush()
    stop()
    expect(seen.count).toBe(1)
  })
})

describe('a subscriber that does not ask for a catch-up', () => {
  it('hears nothing at attach or through the re-check while nothing changes', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    await mkdir(join(sessionDir, 'context'), { recursive: true })
    await writeFile(join(sessionDir, 'context', 'notes.md'), 'existing')
    const timers = manualSchedule()
    const watch = silentWatch()
    const reader = createSessionContextReader({
      home, threadId: sessionId, watchSeams: { watchPath: watch.watchPath, schedule: timers.schedule },
    })
    const seen = counter()
    const stop = reader.subscribe(seen.notify)
    for (let turn = 0; turn < MAX_ATTACH_TURNS && timers.tasks.length === 0; turn += 1) await Bun.sleep(1)
    expect(watch.attached).toHaveLength(1)
    await Bun.sleep(0)
    await timers.flush()
    stop()
    expect(seen.count).toBe(0)
  })
})

describe('reader unsubscribing from its first notification', () => {
  it('closes the watcher and hears nothing further from events or the re-check', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    await mkdir(join(sessionDir, 'context'), { recursive: true })
    const timers = manualSchedule()
    const watch = silentWatch()
    const reader = createSessionContextReader({ home, threadId: sessionId, watchSeams: { watchPath: watch.watchPath, schedule: timers.schedule } })
    const seen = counter()
    let stop: () => void = () => {}
    let first: () => void = () => {}
    const heard = new Promise<void>((resolve) => { first = resolve })
    stop = reader.subscribe(() => { seen.notify(); stop(); first() }, { catchUp: true })
    await heard
    await Bun.sleep(20)
    expect(seen.count).toBe(1)
    expect(watch.attached.map((entry) => entry.closed)).toEqual([true])
    expect(timers.tasks.map((task) => task.cancelled)).toEqual([true])
    watch.attached[0]?.deliver('context')
    await writeFile(join(sessionDir, 'context', 'late.md'), 'late')
    await timers.flush()
    expect(seen.count).toBe(1)
  })

  it('closes a watcher that notified synchronously while attaching', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const closed: boolean[] = []
    const watchPath: WatchPath = (_path, _options, listener) => {
      listener('rename', 'context')
      const index = closed.push(false) - 1
      return { on: () => undefined, close: () => { closed[index] = true } }
    }
    const reader = createSessionContextReader({ home, threadId: sessionId, watchSeams: { watchPath, schedule: manualSchedule().schedule } })
    let stop: () => void = () => {}
    let first: () => void = () => {}
    const heard = new Promise<void>((resolve) => { first = resolve })
    let unsubscribed = false
    stop = reader.subscribe(() => {
      if (!unsubscribed) { unsubscribed = true; stop() }
      first()
    }, { catchUp: true })
    await heard
    await Bun.sleep(20)
    expect(closed).toEqual([true])
  })
})

describe('with the real watcher', () => {
  it('lists a file written right after subscribing, with no retry', async () => {
    const { home, sessionId, sessionDir } = await fixture()
    const reader = createSessionContextReader({ home, threadId: sessionId })
    let resolveChange: () => void = () => {}
    const change = new Promise<void>((resolve) => { resolveChange = resolve })
    const stop = reader.subscribe(resolveChange, { catchUp: true })
    mkdirSync(join(sessionDir, 'context'), { recursive: true })
    writeFileSync(join(sessionDir, 'context', 'notes.md'), 'new note')
    try {
      await change
      expect(await reader.list()).toEqual([{ name: 'notes.md', isDirectory: false }])
    } finally { stop() }
  }, 5000)
})
