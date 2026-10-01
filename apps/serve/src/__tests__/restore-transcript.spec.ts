import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toRunId, toThreadId, type ClockPort, type EventId, type IdPort, type RunId, type ThreadId } from '@dltech/atlas-core'

import { buildSessionArchive, JsonlEventLog, SessionRegistry } from '@dltech/atlas-harness'
import { eventLogFile, sessionDirectory } from '@dltech/atlas-harness'

import { restoreTranscript } from '../restore-transcript'

const THREAD = toThreadId('thread-restore')

const homes: string[] = []
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-restore-spec-'))
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

const seedArchive = async (text: string): Promise<Uint8Array> => {
  const source = freshHome()
  const sourceLog = openLog({ home: source })
  await sourceLog.append({
    threadId: THREAD,
    runId: toRunId('source-run'),
    drafts: [{ type: 'user-said', text }],
  })
  const archive = await buildSessionArchive({
    sessionDir: sessionDirectory({ home: source, sessionId: THREAD }),
  })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

const eventFile = (args: { home: string }): string =>
  eventLogFile({ sessionDir: sessionDirectory({ home: args.home, sessionId: THREAD }), threadId: THREAD })

describe('restoring a transcript the lift shipped late', () => {
  it('extracts the archive and refreshes the store when the session is blank', async () => {
    const home = freshHome()
    const archive = await seedArchive('user-said-it')
    const log = openLog({ home })

    const result = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log,
    })

    expect(result).toEqual({ restored: true, failed: null })
    expect(existsSync(eventFile({ home }))).toBe(true)
    const events = await log.read({ threadId: THREAD })
    expect(events.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))).toEqual([
      'user-said-it',
    ])
  })

  it('a restart with the same tar refreshes a running store without rolling back its newer events', async () => {
    const home = freshHome()
    const archive = await seedArchive('from-the-mac')
    const log = openLog({ home })

    await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log,
    })
    await log.append({
      threadId: THREAD,
      runId: toRunId('cloud-run'),
      drafts: [{ type: 'user-said', text: 'said-in-the-cloud' }],
    })

    const restored = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log,
    })

    expect(restored).toEqual({ restored: true, failed: null })
    const events = await log.read({ threadId: THREAD })
    expect(events.flatMap((event) => (event.type === 'user-said' ? [event.text] : []))).toEqual([
      'from-the-mac',
      'said-in-the-cloud',
    ])
  })

  it('fails naming the missing archive when there is nothing to keep', async () => {
    const home = freshHome()

    const result = await restoreTranscript({
      fetchArchive: async () => null,
      atlasHome: home,
      threadId: THREAD,
      log: openLog({ home }),
    })

    expect(result.restored).toBe(false)
    expect(result.failed).toContain('no transcript archive')
  })
})
