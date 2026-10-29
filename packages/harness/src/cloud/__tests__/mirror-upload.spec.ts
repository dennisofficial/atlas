import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  ELogSeverity,
  ERunner,
  LogPort,
  toRunId,
  toThreadId,
  type LogEntry,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  MAX_POD_EVENTS_PER_FLUSH,
  POD_EVENT_CONFLICT_CODE,
  type PodEvent,
} from '@dltech/atlas-wire'

import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { sessionDirectory } from '../../store/sessions/paths'
import { CloudError } from '../cloud-transport'
import { uploadLocalMirrors, type MirrorUploadClient } from '../mirror-upload'
import { podEventOf } from '../pod-event'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const localThread = async (args: {
  location: EExecutionLocation
  texts: readonly string[]
}): Promise<{ fixture: StoreFixture; threadId: ThreadId }> => {
  const fixture = openStoreFixture()
  held.push(fixture)
  const [first, ...rest] = args.texts
  const created = await fixture.threads.createWithFirstEvents({
    runId: toRunId('run_local'),
    executionLocation: args.location,
    drafts: [{ type: 'user-said', text: first ?? 'first' }],
  })
  const threadId = created.thread.id
  for (const text of rest) {
    await fixture.log.append({
      threadId,
      runId: toRunId('run_local'),
      drafts: [{ type: 'user-said', text }],
    })
  }
  return { fixture, threadId }
}

const fakeRemote = (seed: readonly PodEvent[] = [], reportedHead?: number) => {
  const rows = new Map(seed.map((event) => [event.seq, event]))
  const batches: number[][] = []
  const heads = (): number => Math.max(0, ...rows.keys())
  const client: MirrorUploadClient = {
    threadHead: async () => reportedHead ?? heads(),
    importEvents: async ({ events }) => {
      batches.push(events.map((event) => event.seq))
      for (const event of events) {
        const stored = rows.get(event.seq)
        if (stored !== undefined && stored.body !== event.body) {
          throw new CloudError({
            status: 409,
            message: `seq ${event.seq} conflicts`,
            code: POD_EVENT_CONFLICT_CODE,
          })
        }
      }
      for (const event of events) rows.set(event.seq, event)
      return { head: heads() }
    },
  }
  return { client, rows, batches, heads }
}

const ownEvents = async (args: { fixture: StoreFixture; threadId: ThreadId }) =>
  (await args.fixture.log.readOwn({ threadId: args.threadId })).map(podEventOf)

const stampOf = (args: { fixture: StoreFixture; threadId: ThreadId }): string =>
  join(
    sessionDirectory({ home: args.fixture.home, sessionId: args.threadId }),
    '.postgres-upload.json',
  )

describe('uploadLocalMirrors', () => {
  it('ships only the seqs Postgres lacks and stamps the session', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Cloud,
      texts: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    const remote = fakeRemote((await ownEvents({ fixture, threadId })).slice(0, 3))

    await uploadLocalMirrors({ home: fixture.home, client: remote.client, log: new RecordingLog() })

    expect(remote.batches).toEqual([[4, 5, 6]])
    expect(remote.heads()).toBe(6)
    expect(existsSync(stampOf({ fixture, threadId }))).toBe(true)
  })

  it('ships a long log in batches of at most the flush limit', async () => {
    const texts = Array.from({ length: MAX_POD_EVENTS_PER_FLUSH + 20 }, (_, index) => `m${index}`)
    const { fixture } = await localThread({ location: EExecutionLocation.Cloud, texts })
    const remote = fakeRemote()

    await uploadLocalMirrors({ home: fixture.home, client: remote.client, log: new RecordingLog() })

    expect(remote.batches.map((batch) => batch.length)).toEqual([MAX_POD_EVENTS_PER_FLUSH, 20])
  })

  it('logs a conflict, stops that thread, leaves it unstamped and does not throw', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Cloud,
      texts: ['a', 'b', 'c'],
    })
    const own = await ownEvents({ fixture, threadId })
    const differing = { ...own[1]!, body: '{"type":"user-said","text":"someone else"}' }
    const remote = fakeRemote([own[0]!, differing], 1)
    const log = new RecordingLog()

    await uploadLocalMirrors({ home: fixture.home, client: remote.client, log })

    expect(remote.batches).toHaveLength(1)
    expect(existsSync(stampOf({ fixture, threadId }))).toBe(false)
    const logged = log.entries.find((entry) => entry.severity === ELogSeverity.Warn)
    expect(logged?.threadId).toBe(threadId)
    expect(logged?.message).toContain('seq 2')
  })

  it('skips a stamped thread on the next start without asking the control plane', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Cloud,
      texts: ['a', 'b'],
    })
    const remote = fakeRemote()
    await uploadLocalMirrors({ home: fixture.home, client: remote.client, log: new RecordingLog() })
    const asked: string[] = []

    await uploadLocalMirrors({
      home: fixture.home,
      client: {
        threadHead: async () => {
          asked.push('head')
          return 0
        },
        importEvents: remote.client.importEvents,
      },
      log: new RecordingLog(),
    })

    expect(asked).toEqual([])
    expect(existsSync(stampOf({ fixture, threadId }))).toBe(true)
  })

  it('does nothing and stamps when the remote head is at or past the local head', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Cloud,
      texts: ['a', 'b'],
    })
    const remote = fakeRemote(await ownEvents({ fixture, threadId }))

    await uploadLocalMirrors({ home: fixture.home, client: remote.client, log: new RecordingLog() })

    expect(remote.batches).toEqual([])
    expect(existsSync(stampOf({ fixture, threadId }))).toBe(true)
  })

  it('leaves a thread that is not cloud-placed alone', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Host,
      texts: ['a', 'b'],
    })
    const remote = fakeRemote()

    await uploadLocalMirrors({ home: fixture.home, client: remote.client, log: new RecordingLog() })

    expect(remote.batches).toEqual([])
    expect(existsSync(stampOf({ fixture, threadId }))).toBe(false)
  })

  it('never sends a cloud-placed thread whose runner is local', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Cloud,
      texts: ['a', 'b'],
    })
    await fixture.threads.chooseRunner({ threadId, runner: ERunner.Local })
    const heads: string[] = []
    const remote = fakeRemote()

    await uploadLocalMirrors({
      home: fixture.home,
      client: {
        threadHead: async (args) => {
          heads.push(args.threadId)
          return 0
        },
        importEvents: remote.client.importEvents,
      },
      log: new RecordingLog(),
    })

    expect(heads).toEqual([])
    expect(remote.batches).toEqual([])
    expect(existsSync(stampOf({ fixture, threadId }))).toBe(false)
  })

  it('still sends a cloud-placed thread whose runner is vercel', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Cloud,
      texts: ['a', 'b'],
    })
    await fixture.threads.chooseRunner({ threadId, runner: ERunner.Vercel })
    const remote = fakeRemote()

    await uploadLocalMirrors({ home: fixture.home, client: remote.client, log: new RecordingLog() })

    expect(remote.batches).toEqual([[1, 2]])
  })

  it('logs and carries on when the control plane cannot be reached for a thread', async () => {
    const { fixture, threadId } = await localThread({
      location: EExecutionLocation.Cloud,
      texts: ['a'],
    })
    const log = new RecordingLog()

    await uploadLocalMirrors({
      home: fixture.home,
      client: {
        threadHead: async () => {
          throw new CloudError({ status: 404, message: 'thread not found' })
        },
        importEvents: async () => ({ head: 0 }),
      },
      log,
    })

    expect(existsSync(stampOf({ fixture, threadId }))).toBe(false)
    expect(log.entries.some((entry) => entry.threadId === toThreadId(threadId))).toBe(true)
  })
})
