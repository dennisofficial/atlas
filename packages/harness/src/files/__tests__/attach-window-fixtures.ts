import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'

import { sessionDirectory } from '../../store/sessions/paths'
import type { ContextSignature } from '../context-signature'
import type { ScanContext, Schedule, WatchPath } from '../watch-context-directory'

const homes: string[] = []
export async function cleanupHomes() {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
}

export async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-attach-window-'))
  homes.push(home)
  const sessionId = toThreadId('root')
  return { home, sessionId, sessionDir: sessionDirectory({ home, sessionId }) }
}

export function silentWatch() {
  type Entry = { path: string; closed: boolean; deliver: (name: string) => void; fail: () => void }
  const attached: Entry[] = []
  const watchPath: WatchPath = (path, _options, listener) => {
    if (!existsSync(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    let errorListener: () => void = () => {}
    const entry: Entry = { path, closed: false, deliver: (name) => listener('rename', name), fail: () => errorListener() }
    attached.push(entry)
    return { on: (_event, handler) => { errorListener = handler }, close: () => { entry.closed = true } }
  }
  return { attached, watchPath }
}

export function manualSchedule() {
  const tasks: { run: () => Promise<void>; cancelled: boolean }[] = []
  const schedule: Schedule = ({ run }) => {
    const task = { run, cancelled: false }
    tasks.push(task)
    return () => { task.cancelled = true }
  }
  const flush = async () => { for (const task of tasks.splice(0)) if (!task.cancelled) await task.run() }
  return { tasks, schedule, flush }
}

export function scriptedScan(signatures: ContextSignature[]) {
  const calls: number[] = []
  const scanContext: ScanContext = async () => {
    calls.push(calls.length)
    return signatures[Math.min(calls.length - 1, signatures.length - 1)] ?? { signature: '', capped: false }
  }
  return { calls, scanContext }
}

export function counter() {
  let count = 0
  return { notify: () => { count += 1 }, get count() { return count } }
}

export const tick = () => Bun.sleep(0)
export const unchanged: ContextSignature = { signature: 'notes.md:1:1', capped: false }
export const changed: ContextSignature = { signature: 'notes.md:2:2', capped: false }
