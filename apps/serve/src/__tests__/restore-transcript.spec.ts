import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { EExecutionLocation, toRunId, toThreadId, type ClockPort, type EventId, type IdPort, type RunId, type ThreadId } from '@dltech/atlas-core'

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
      ids: fixedIds({ prefix: 'spec' }),
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
      ids: fixedIds({ prefix: 'spec' }),
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
      ids: fixedIds({ prefix: 'spec' }),
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
      ids: fixedIds({ prefix: 'spec' }),
    })

    expect(result.restored).toBe(false)
    expect(result.failed).toContain('no transcript archive')
  })

  it('pins the lift’s location-changed marker on the restored log', async () => {
    const home = freshHome()
    const archive = await seedArchive('before-the-lift')
    const log = openLog({ home })

    const result = await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log,
      ids: fixedIds({ prefix: 'spec' }),
      marker: {
        from: 'host',
        to: 'cloud',
        cwd: '/workspace',
        remoteUrl: 'git@github.com:comp-ai/atlas.git',
        branch: 'dennis/container-cloud',
      },
    })

    expect(result).toEqual({ restored: true, failed: null })
    const events = await log.read({ threadId: THREAD })
    const marker = events.at(-1)
    if (marker?.type !== 'location-changed') throw new Error('expected a trailing location-changed')
    expect(marker.from).toBe(EExecutionLocation.Host)
    expect(marker.to).toBe(EExecutionLocation.Cloud)
    expect(marker.cwd).toBe('/workspace')
    expect(marker.remoteUrl).toBe('git@github.com:comp-ai/atlas.git')
    expect(marker.branch).toBe('dennis/container-cloud')
  })

  it('does not pin a second marker when a re-restore already ends at the cloud', async () => {
    const home = freshHome()
    const archive = await seedArchive('before-the-lift')
    const log = openLog({ home })
    const marker = { from: 'host', to: 'cloud' } as const

    await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log,
      ids: fixedIds({ prefix: 'spec' }),
      marker,
    })
    await restoreTranscript({
      fetchArchive: async () => archive,
      atlasHome: home,
      threadId: THREAD,
      log,
      ids: fixedIds({ prefix: 'spec' }),
      marker,
    })

    const events = await log.read({ threadId: THREAD })
    expect(events.filter((event) => event.type === 'location-changed')).toHaveLength(1)
  })
})
