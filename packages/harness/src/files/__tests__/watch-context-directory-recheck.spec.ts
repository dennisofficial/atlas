import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { watchContextDirectory, type Schedule, type WatchPath } from '../watch-context-directory'
import type { ContextSignature } from '../context-signature'
import {
  changed,
  cleanupHomes,
  counter,
  fixture,
  manualSchedule,
  scriptedScan,
  silentWatch,
  tick,
  unchanged,
} from './attach-window-fixtures'

afterEach(cleanupHomes)

describe('steady state without a session directory', () => {
  it('yields exactly one catch-up while the session directory does not exist yet', async () => {
    const { sessionDir } = await fixture()
    const home = join(sessionDir, '..', '..')
    await mkdir(join(home, 'sessions'), { recursive: true })
    const timers = manualSchedule()
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: silentWatch().watchPath,
      schedule: timers.schedule,
      scanContext: scriptedScan([{ signature: '', capped: false }]).scanContext,
    })
    await tick()
    await timers.flush()
    stop()
    expect(seen.count).toBe(1)
  })
})

describe('native watch startup gap', () => {
  it('notices a change whose event the watch dropped', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const timers = manualSchedule()
    const scan = scriptedScan([unchanged, changed])
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: silentWatch().watchPath,
      schedule: timers.schedule,
      scanContext: scan.scanContext,
    })
    await tick()
    expect(seen.count).toBe(1)
    await timers.flush()
    stop()
    expect(seen.count).toBe(2)
    expect(scan.calls.length).toBe(2)
  })

  it('stays silent when the re-check finds the same signature', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const timers = manualSchedule()
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: silentWatch().watchPath,
      schedule: timers.schedule,
      scanContext: scriptedScan([unchanged, unchanged]).scanContext,
    })
    await tick()
    await timers.flush()
    stop()
    expect(seen.count).toBe(1)
  })

  it('notifies conservatively when either scan hit the entry cap', async () => {
    for (const script of [
      [
        { signature: 'a', capped: true },
        { signature: 'a', capped: false },
      ],
      [
        { signature: 'a', capped: false },
        { signature: 'a', capped: true },
      ],
    ]) {
      const { sessionDir } = await fixture()
      await mkdir(sessionDir, { recursive: true })
      const timers = manualSchedule()
      const seen = counter()
      const stop = watchContextDirectory({
        sessionDir,
        catchUp: true,
        onChange: seen.notify,
        watchPath: silentWatch().watchPath,
        schedule: timers.schedule,
        scanContext: scriptedScan(script).scanContext,
      })
      await tick()
      await timers.flush()
      stop()
      expect(seen.count).toBe(2)
    }
  })

  it('does not notify again when the watch delivered the change itself', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const timers = manualSchedule()
    const watch = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: watch.watchPath,
      schedule: timers.schedule,
      scanContext: scriptedScan([unchanged, changed]).scanContext,
    })
    await tick()
    watch.attached[0]?.deliver('context')
    await timers.flush()
    stop()
    expect(seen.count).toBe(2)
  })

  it('does not double notify when the watch errors and the scan also differs', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const timers = manualSchedule()
    const watch = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: watch.watchPath,
      schedule: timers.schedule,
      scanContext: scriptedScan([unchanged, changed]).scanContext,
    })
    await tick()
    watch.attached[0]?.fail()
    await timers.flush()
    stop()
    expect(seen.count).toBe(2)
  })

  it('covers the replacement watcher on ancestor handover and cancels the old re-check', async () => {
    const { home, sessionDir } = await fixture()
    const sessions = join(home, 'sessions')
    await mkdir(sessions, { recursive: true })
    const timers = manualSchedule()
    const watch = silentWatch()
    const scan = scriptedScan([unchanged, unchanged, changed])
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: watch.watchPath,
      schedule: timers.schedule,
      scanContext: scan.scanContext,
    })
    await tick()
    expect(watch.attached.map((entry) => entry.path)).toEqual([sessions])
    expect(timers.tasks.map((task) => task.cancelled)).toEqual([false])
    await mkdir(sessionDir)
    watch.attached[0]?.deliver('root')
    expect(seen.count).toBe(2)
    expect(watch.attached.map((entry) => [entry.path, entry.closed])).toEqual([
      [sessions, true],
      [sessionDir, false],
    ])
    expect(timers.tasks.map((task) => task.cancelled)).toEqual([true, false])
    await timers.flush()
    stop()
    expect(seen.count).toBe(3)
  })

  it('re-attaches from the re-check when the session directory appeared in the gap', async () => {
    const { home, sessionDir } = await fixture()
    const sessions = join(home, 'sessions')
    await mkdir(sessions, { recursive: true })
    const timers = manualSchedule()
    const watch = silentWatch()
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: watch.watchPath,
      schedule: timers.schedule,
      scanContext: scriptedScan([unchanged, changed]).scanContext,
    })
    await tick()
    await mkdir(sessionDir)
    await timers.flush()
    expect(watch.attached.map((entry) => [entry.path, entry.closed])).toEqual([
      [sessions, true],
      [sessionDir, false],
    ])
    expect(timers.tasks.length).toBe(1)
    stop()
    expect(seen.count).toBe(2)
  })
})

describe('stopping', () => {
  it('cancels the pending re-check timer and never scans again', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const timers = manualSchedule()
    const scan = scriptedScan([unchanged, changed])
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: silentWatch().watchPath,
      schedule: timers.schedule,
      scanContext: scan.scanContext,
    })
    stop()
    expect(timers.tasks.map((task) => task.cancelled)).toEqual([true])
    await tick()
    await timers.tasks[0]?.run()
    expect(scan.calls.length).toBe(1)
    expect(seen.count).toBe(0)
  })

  it('never fires the real timer after stop', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const scan = scriptedScan([unchanged, changed])
    const seen = counter()
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: seen.notify,
      watchPath: silentWatch().watchPath,
      scanContext: scan.scanContext,
    })
    stop()
    await Bun.sleep(150)
    expect(scan.calls.length).toBe(1)
    expect(seen.count).toBe(0)
  })

  it('lets a listener unsubscribe from the catch-up notification without leaking the watcher', async () => {
    const { sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const timers = manualSchedule()
    const watch = silentWatch()
    const scan = scriptedScan([unchanged, changed])
    const seen = counter()
    let stop: () => void = () => {}
    stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: () => {
        seen.notify()
        stop()
      },
      watchPath: watch.watchPath,
      schedule: timers.schedule,
      scanContext: scan.scanContext,
    })
    await tick()
    expect(seen.count).toBe(1)
    expect(watch.attached.map((entry) => entry.closed)).toEqual([true])
    expect(timers.tasks.map((task) => task.cancelled)).toEqual([true])
    watch.attached[0]?.deliver('context')
    await timers.flush()
    expect(seen.count).toBe(1)
  })
})

describe('re-attach budget', () => {
  it('stops scheduling re-checks when the session directory exists but cannot be watched', async () => {
    const { home, sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const inner = silentWatch()
    const watchPath: WatchPath = (path, options, listener) => {
      if (path === sessionDir) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
      return inner.watchPath(path, options, listener)
    }
    const timers = manualSchedule()
    let scheduled = 0
    const schedule: Schedule = (task) => {
      scheduled += 1
      return timers.schedule(task)
    }
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: counter().notify,
      watchPath,
      schedule,
      scanContext: scriptedScan([unchanged]).scanContext,
    })
    await tick()
    for (let round = 0; round < 10; round += 1) await timers.flush()
    stop()
    expect(inner.attached.map((entry) => entry.path)).toEqual([
      join(home, 'sessions'),
      join(home, 'sessions'),
    ])
    expect(scheduled).toBe(2)
  })

  it('re-attaches to each ancestor at most once when the session directory keeps appearing and vanishing', async () => {
    const { home, sessionDir } = await fixture()
    await mkdir(join(home, 'sessions'), { recursive: true })
    const timers = manualSchedule()
    let scheduled = 0
    const schedule: Schedule = (task) => {
      scheduled += 1
      return timers.schedule(task)
    }
    const stop = watchContextDirectory({
      sessionDir,
      catchUp: true,
      onChange: counter().notify,
      watchPath: silentWatch().watchPath,
      schedule,
      scanContext: scriptedScan([unchanged]).scanContext,
    })
    await tick()
    for (let round = 0; round < 8; round += 1) {
      if (round % 2 === 0) await mkdir(sessionDir, { recursive: true })
      else await rm(sessionDir, { recursive: true, force: true })
      await timers.flush()
    }
    stop()
    expect(scheduled).toBe(3)
    expect(timers.tasks).toHaveLength(0)
  })
})
