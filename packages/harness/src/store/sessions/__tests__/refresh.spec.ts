import { afterEach, describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogPort, toThreadId, type LogEntry } from '@dltech/atlas-core'
import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { eventLogFile, sessionDirectory } from '../paths'
import { SessionRegistry } from '../registry'

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

const createLog = async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-refresh-'))
  homes.push(home)
  const registry = new SessionRegistry(home)
  const ids = new CountingIds('refresh')
  const log = new JsonlEventLog(home, registry, new SteppingClock(), ids)
  return { home, registry, ids, log }
}
const root = toThreadId('brn_refresh')
const child = toThreadId('brn_child')

class ReplacingLog extends LogPort {
  constructor(private readonly replace: () => void) {
    super()
  }
  record(_entry: LogEntry): void {
    this.replace()
  }
}

describe('explicit out-of-band transcript refresh', () => {
  it('does not let a read from the previous generation refill the cache', async () => {
    const { home, ids, log } = await createLog()
    await log.append({
      threadId: root,
      runId: ids.nextRunId(),
      drafts: [{ type: 'user-said', text: 'old' }],
    })
    const sessionDir = sessionDirectory({ home, sessionId: root })
    const file = eventLogFile({ sessionDir, threadId: root })
    const original = await readFile(file, 'utf8')
    await writeFile(file, `${original}malformed-json\n`)
    const registry = new SessionRegistry(
      home,
      new ReplacingLog(() => {
        writeFileSync(file, original.replace('"old"', '"new"'))
        registry.invalidateSession({ sessionDir })
      }),
    )
    const read = await registry.readThreadLog({ sessionDir, threadId: root })
    expect(read.events[0]?.type === 'user-said' && read.events[0].text).toBe('new')
    expect(read.unreadable).toEqual([])
    expect(registry.handleFor({ sessionDir }).threads.get(root)).toBe(read)
  })
  it('rereads even a replacement with the same file length and timestamp', async () => {
    const { home, ids, log } = await createLog()
    await log.append({
      threadId: root,
      runId: ids.nextRunId(),
      drafts: [{ type: 'user-said', text: 'old' }],
    })
    const file = eventLogFile({
      sessionDir: sessionDirectory({ home, sessionId: root }),
      threadId: root,
    })
    const signature = await stat(file)
    const original = await readFile(file, 'utf8')
    await writeFile(file, original.replace('"old"', '"new"'))
    await utimes(file, signature.atime, signature.mtime)
    const stale = await log.readOwn({ threadId: root })
    expect(stale[0]?.type === 'user-said' && stale[0].text).toBe('old')
    await log.refresh({ threadId: root })
    const refreshed = await log.readOwn({ threadId: root })
    expect(refreshed[0]?.type === 'user-said' && refreshed[0].text).toBe('new')
  })

  it('invalidates every child cached from the replaced session directory', async () => {
    const { home, registry, ids, log } = await createLog()
    const sessionDir = sessionDirectory({ home, sessionId: root })
    registry.registerThread({ sessionDir, threadId: child })
    await log.append({
      threadId: root,
      runId: ids.nextRunId(),
      drafts: [{ type: 'user-said', text: 'root' }],
    })
    await log.append({
      threadId: child,
      runId: ids.nextRunId(),
      drafts: [{ type: 'user-said', text: 'old' }],
    })
    const file = eventLogFile({ sessionDir, threadId: child })
    const text = await readFile(file, 'utf8')
    await writeFile(file, text.replace('"old"', '"new"'))
    await log.refresh({ threadId: root })
    const refreshed = await log.readOwn({ threadId: child })
    expect(refreshed[0]?.type === 'user-said' && refreshed[0].text).toBe('new')
  })
})
