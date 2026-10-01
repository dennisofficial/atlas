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

describe('the transcript origin marker and the busy guard', () => {
  it('a boot against a blank drive answers fresh without failing and stamps the origin', async () => {
    const home = freshHome()

    const boot = await applyTranscriptArchive({
      fetchArchive: async () => null,
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })

    expect(boot).toEqual({ applied: false, digestMatched: false, fresh: true, failed: null })
    const origin = await readTranscriptOrigin({
      sessionDir: sessionDirectory({ home, sessionId: THREAD }),
    })
    expect(origin).toEqual({ threadId: THREAD, archiveDigest: null, initialized: true })
  })

  it('a boot keeps its resumed log when the drive stops answering', async () => {
    const home = freshHome()
    capabilityOnlyLog({ home })

    const boot = await applyTranscriptArchive({
      fetchArchive: async () => {
        throw new Error('the drive detached')
      },
      atlasHome: home,
      threadId: THREAD,
      explicit: false,
    })

    expect(boot).toEqual({ applied: false, digestMatched: false, fresh: false, failed: null })
  })

  it('a verified apply stamps the archive digest, and a rewind never deletes the marker', async () => {
    const home = freshHome()
    const { archive } = await seedArchiveHome({ text: 'first' })
    const log = openLog({ home })

    await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log,
      ids: fixedIds({ prefix: 'spec' }),
    })
    const stamped = await readTranscriptOrigin({
      sessionDir: sessionDirectory({ home, sessionId: THREAD }),
    })
    expect(stamped?.archiveDigest).toMatch(/^[0-9a-f]{64}$/)

    const store = openLog({ home })
    const threads = unstaffedThreads()
    threads.rewind = async () => {}
    await rewindThread({
      log: store,
      threads,
      machinery: new NoMachinery(),
      threadId: THREAD,
      toSeq: 0,
      confirmed: true,
    })

    const after = await readTranscriptOrigin({
      sessionDir: sessionDirectory({ home, sessionId: THREAD }),
    })
    expect(after?.archiveDigest).toBe(stamped?.archiveDigest)
  })

  it('a busy guard refuses the replacement but never the digest-matched refresh', async () => {
    const home = freshHome()
    const { archive } = await seedArchiveHome({ text: 'one' })
    await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
    })

    const busy = 'children are resuming'
    const matched = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
      refuseIfBusy: () => busy,
    })
    expect(matched).toEqual({ restored: true, failed: null })

    const { archive: updated } = await seedArchiveHome({ text: 'two' })
    const refused = await restoreTranscript({
      fetchArchive: async () => updated,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
      ids: fixedIds({ prefix: 'spec' }),
      refuseIfBusy: () => busy,
    })
    expect(refused.restored).toBe(false)
    expect(refused.failed).toBe(busy)
    expect(await logTexts({ home })).toEqual(['one'])
  })
})
