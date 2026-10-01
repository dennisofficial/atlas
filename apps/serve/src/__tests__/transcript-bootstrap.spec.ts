import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toRunId, toThreadId, type ClockPort, type EventId, type IdPort, type RunId, type ThreadId } from '@dltech/atlas-core'

import { buildSessionArchive, JsonlEventLog, SessionRegistry } from '@dltech/atlas-harness'
import { eventLogFile, sessionDirectory } from '@dltech/atlas-harness'

import { restoreTranscript } from '../restore-transcript'
import { applyTranscriptArchive, readTranscriptOrigin } from '../transcript-bootstrap'
import { rewindThread, RewindMachineryPort, ThreadStorePort } from '@dltech/atlas-harness'

class NoMachinery extends RewindMachineryPort {
  snapshot() {
    return Promise.resolve({ reachable: true, kills: [] })
  }
  destroy() {
    return Promise.resolve()
  }
}

const unstaffedThreads = (): ThreadStorePort =>
  Object.create(ThreadStorePort.prototype) as ThreadStorePort

const THREAD = toThreadId('thread-bootstrap')

const homes: string[] = []
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-bootstrap-spec-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const clock: ClockPort = { now: () => new Date().toISOString() }

const fixedIds = (args: { prefix: string }): IdPort => {
  let runs = 0
  let events = 0
  return {
    nextThreadId: (): ThreadId => THREAD,
    nextRunId: (): RunId => {
      runs += 1
      return toRunId(`${args.prefix}-run-${runs}`)
    },
    nextEventId: (): EventId => {
      events += 1
      return `${args.prefix}-event-${events}` as EventId
    },
    nextCallId: () => `${args.prefix}-call-1` as ReturnType<IdPort['nextCallId']>,
  }
}

const openLog = (args: { home: string }): JsonlEventLog =>
  new JsonlEventLog(args.home, new SessionRegistry(args.home), clock, fixedIds({ prefix: 'spec' }))

const appendSaid = async (args: { home: string; text: string }): Promise<void> => {
  const log = openLog({ home: args.home })
  await log.append({
    threadId: THREAD,
    runId: toRunId(`${args.text}-run`),
    drafts: [{ type: 'user-said', text: args.text }],
  })
}

const archiveOf = async (args: { home: string }): Promise<Uint8Array> => {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: THREAD })
  const archive = await buildSessionArchive({ sessionDir })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

const seedArchiveHome = async (args: { text: string }): Promise<{ source: string; archive: Uint8Array }> => {
  const source = freshHome()
  await appendSaid({ home: source, text: args.text })
  return { source, archive: await archiveOf({ home: source }) }
}

const logTexts = async (args: { home: string }): Promise<readonly string[]> => {
  const log = openLog({ home: args.home })
  const events = await log.read({ threadId: THREAD })
  return events.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))
}

const receiptText = (args: { home: string }): string | null => {
  const file = join(args.home, 'bootstrap', 'transcript-applied.sha256')
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
}

const eventFile = (args: { home: string }): string =>
  eventLogFile({ sessionDir: sessionDirectory({ home: args.home, sessionId: THREAD }), threadId: THREAD })

const capabilityOnlyLog = (args: { home: string }): void => {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: THREAD })
  mkdirSync(join(sessionDir, 'threads'), { recursive: true })
  writeFileSync(eventFile({ home: args.home }), '')
}

describe('applying a transcript archive generation-aware', () => {
  it('a boot with a capability-only log and no receipt keeps the log and never extracts', async () => {
    const home = freshHome()
    capabilityOnlyLog({ home })
    const { archive } = await seedArchiveHome({ text: 'lifted' })
    let fetches = 0

    const boot = await applyTranscriptArchive({
      fetchArchive: async () => {
        fetches += 1
        return archive
      },
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })

    expect(boot).toEqual({ applied: false, digestMatched: false, fresh: false, failed: null })
    expect(fetches).toBe(1)
    expect(readFileSync(eventFile({ home }), 'utf8')).toBe('')

    const restore = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })

    expect(restore).toEqual({ restored: true, failed: null })
    expect(await logTexts({ home })).toEqual(['lifted'])
    expect(receiptText({ home })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a restart against the same uploaded tar keeps the cloud append rather than re-extracting', async () => {
    const home = freshHome()
    const { archive } = await seedArchiveHome({ text: 'from-the-mac' })

    const first = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })
    expect(first).toEqual({ restored: true, failed: null })

    await appendSaid({ home, text: 'said-in-the-cloud' })

    const boot = await applyTranscriptArchive({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })
    expect(boot).toEqual({ applied: false, digestMatched: true, fresh: false, failed: null })

    const again = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })
    expect(again).toEqual({ restored: true, failed: null })

    expect(await logTexts({ home })).toEqual(['from-the-mac', 'said-in-the-cloud'])
  })

  it('an updated tar replaces the old generation and moves the receipt', async () => {
    const home = freshHome()
    const { archive: first } = await seedArchiveHome({ text: 'first-generation' })
    await restoreTranscript({
      fetchArchive: async () => first,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })
    const firstReceipt = receiptText({ home })

    const { archive: second } = await seedArchiveHome({ text: 'second-generation' })
    const restored = await restoreTranscript({
      fetchArchive: async () => second,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })

    expect(restored).toEqual({ restored: true, failed: null })
    expect(await logTexts({ home })).toEqual(['second-generation'])
    expect(receiptText({ home })).not.toBe(firstReceipt)
  })

  it('recovers the archive when the log is missing even though the digest already matches', async () => {
    const home = freshHome()
    const { archive } = await seedArchiveHome({ text: 'gone-but-matched' })

    await applyTranscriptArchive({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })
    rmSync(eventFile({ home }))
    expect(existsSync(eventFile({ home }))).toBe(false)

    const boot = await applyTranscriptArchive({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })

    expect(boot).toEqual({ applied: true, digestMatched: true, fresh: false, failed: null })
    expect(await logTexts({ home })).toEqual(['gone-but-matched'])
  })

  it('an archive that will not untar reports failure, writes no receipt, and claims nothing applied', async () => {
    const home = freshHome()

    const boot = await applyTranscriptArchive({
      fetchArchive: async () => Buffer.from('not a tar'),
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })

    expect(boot.applied).toBe(false)
    expect(boot.failed).toContain('did not extract')
    expect(receiptText({ home })).toBeNull()

    const restore = await restoreTranscript({
      fetchArchive: async () => Buffer.from('not a tar'),
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })

    expect(restore.restored).toBe(false)
    expect(restore.failed).toContain('did not extract')
    expect(receiptText({ home })).toBeNull()
  })

  it('an archive without the served thread’s events fails the explicit restore without touching the local log', async () => {
    const home = freshHome()
    capabilityOnlyLog({ home })

    const foreign = freshHome()
    const foreignLog = openLog({ home: foreign })
    const foreignThread = toThreadId('thread-foreign')
    await foreignLog.append({
      threadId: foreignThread,
      runId: toRunId('foreign-run'),
      drafts: [{ type: 'user-said', text: 'not this thread' }],
    })
    const archive = await buildSessionArchive({
      sessionDir: sessionDirectory({ home: foreign, sessionId: foreignThread }),
    })
    if (archive === undefined) throw new Error('expected an archive')

    const before = readFileSync(eventFile({ home }), 'utf8')
    const boot = await applyTranscriptArchive({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })

    expect(boot).toEqual({ applied: false, digestMatched: false, fresh: false, failed: null })
    expect(readFileSync(eventFile({ home }), 'utf8')).toBe(before)

    const restore = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })
    expect(restore.restored).toBe(false)
    expect(restore.failed).toContain('no events for this thread')
  })

  it('an explicit restore fails when the drive holds no archive, even with a log on disk', async () => {
    const home = freshHome()
    capabilityOnlyLog({ home })

    const restore = await restoreTranscript({
      fetchArchive: async () => null,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })

    expect(restore.restored).toBe(false)
    expect(restore.failed).toContain('no transcript archive')
    expect(existsSync(eventFile({ home }))).toBe(true)
  })
})
