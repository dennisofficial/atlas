import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toEventId, toRunId, toThreadId, type Event, type ThreadId } from '@dltech/atlas-core'

import { mirrorWriter } from '../mirror-writer'
import { mirrorLockFile } from '../mirror-lock'
import { eventLogFile, sessionDirectory } from '../../store/sessions/paths'
import { SessionRegistry } from '../../store/sessions/registry'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'

const THREAD = toThreadId('brn_local_pod')
const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const homeOf = (): string => {
  const fixture = openStoreFixture()
  fixtures.push(fixture)
  return fixture.home
}

const eventAt = (seq: number): Event => ({
  type: 'user-said',
  text: `said ${seq}`,
  id: toEventId(`pod-evt-${seq}`),
  seq,
  threadId: THREAD,
  runId: toRunId('pod-run'),
  depth: 0,
  at: '2026-10-30T00:00:00.000Z',
})

const range = (from: number, to: number): Event[] =>
  Array.from({ length: to - from + 1 }, (_, index) => eventAt(from + index))

const fileOf = (home: string, threadId: ThreadId = THREAD): string =>
  eventLogFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })

const seqsOnDisk = (home: string): number[] =>
  readFileSync(fileOf(home), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { seq: number }).seq)

const writerIn = (home: string) =>
  mirrorWriter({ home: () => home, registry: () => new SessionRegistry(home) })

describe('appending a pod delta by seq', () => {
  it('appends what lies past the local head', async () => {
    const home = homeOf()
    const writer = writerIn(home)

    expect(await writer.appendFrom({ threadId: THREAD, events: range(1, 3) })).toEqual({
      head: 3,
    })

    expect(seqsOnDisk(home)).toEqual([1, 2, 3])
  })

  it('drops events it already holds, so a repeated delivery is a no-op', async () => {
    const home = homeOf()
    const writer = writerIn(home)
    await writer.appendFrom({ threadId: THREAD, events: range(1, 3) })

    await writer.appendFrom({ threadId: THREAD, events: range(2, 5) })
    await writer.appendFrom({ threadId: THREAD, events: range(1, 5) })

    expect(seqsOnDisk(home)).toEqual([1, 2, 3, 4, 5])
  })

  it('refuses a delta that would leave a gap', async () => {
    const home = homeOf()
    const writer = writerIn(home)
    await writer.appendFrom({ threadId: THREAD, events: range(1, 2) })

    expect(await writer.appendFrom({ threadId: THREAD, events: range(5, 6) })).toEqual({
      head: 2,
      gapAt: 3,
    })
    expect(seqsOnDisk(home)).toEqual([1, 2])
  })

  it('lands each seq exactly once when two processes copy the same pod at once', async () => {
    const home = homeOf()
    const processCopy = async (deltas: readonly Event[][]): Promise<void> => {
      const registry = new SessionRegistry(home)
      const writer = mirrorWriter({ home: () => home, registry: () => registry })
      for (const events of deltas) await writer.appendFrom({ threadId: THREAD, events })
    }

    await Promise.all([
      processCopy([range(1, 4), range(3, 8), range(7, 10)]),
      processCopy([range(1, 6), range(5, 10)]),
    ])

    expect(seqsOnDisk(home)).toEqual(range(1, 10).map((event) => event.seq))
  })

  it('takes over a lock left behind by a process that died', async () => {
    const home = homeOf()
    const lock = mirrorLockFile({ eventsFile: fileOf(home) })
    mkdirSync(dirname(lock), { recursive: true })
    writeFileSync(lock, JSON.stringify({ pid: 2147483646 }))

    await writerIn(home).appendFrom({ threadId: THREAD, events: range(1, 2) })

    expect(seqsOnDisk(home)).toEqual([1, 2])
  })
})
