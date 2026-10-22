import { afterEach, describe, expect, it } from 'bun:test'

import {
  transcriptIdentityDigest,
  toEventId,
  toRunId,
  type Event,
  type EventDraft,
  type EventEnvelope,
  type ThreadId,
} from '@dltech/atlas-core'
import { EServeFrame } from '@dltech/atlas-wire'

import { EClientRequest } from '../channel-wire'
import { MirroredEventLog } from '../mirrored-event-log'
import { mirrorWriter, type MirrorWriter } from '../mirror-writer'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { readied, THREAD } from './remote-channel-fixture'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const remoteEvent = ({ threadId, seq, text }: { threadId: ThreadId; seq: number; text: string }): Event => {
  const draft: EventDraft = { type: 'user-said', text }
  const envelope: EventEnvelope = {
    id: toEventId(`remote-evt-${seq}`),
    seq,
    threadId,
    runId: toRunId('remote-run'),
    depth: 0,
    at: `2026-10-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
  }
  return { ...draft, ...envelope }
}

const wireOf = (event: Event) => ({
  id: event.id,
  threadId: event.threadId,
  seq: event.seq,
  runId: event.runId,
  depth: event.depth,
  at: event.at,
  type: event.type,
  body: JSON.stringify(event),
})

const settled = async (probe: () => boolean | Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await probe()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('never settled')
}

const quiet = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40))

const gate = () => {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return { released, release }
}

const rig = async (args: {
  localTexts: readonly string[]
  wrapWriter?: ((real: MirrorWriter) => MirrorWriter) | undefined
}) => {
  const fixture = await openStoreFixture()
  fixtures.push(fixture)
  const threadId = THREAD
  await fixture.threads.create({ id: threadId })
  for (const text of args.localTexts) {
    await fixture.log.append({
      threadId,
      runId: toRunId('local-run'),
      drafts: [{ type: 'user-said', text }],
    })
  }

  const remote: Event[] = []
  const channel = readied({ lastEventSeq: 0 })
  const request = async (requestArgs: { op: unknown; params: unknown }): Promise<unknown> => {
    const params = requestArgs.params as { fromSeq?: number; upTo?: number }
    if (requestArgs.op === EClientRequest.ReadTranscriptIdentity) {
      const prefix = remote.filter((event) => event.seq <= (params.upTo ?? Number.MAX_SAFE_INTEGER))
      return { count: prefix.length, digest: transcriptIdentityDigest(prefix) }
    }
    const fromSeq = params.fromSeq ?? 0
    return { events: remote.filter((event) => event.seq > fromSeq).map(wireOf) }
  }

  const failures: unknown[] = []
  const realWriter = mirrorWriter({ home: () => fixture.home })
  const log = new MirroredEventLog({
    channel: { ...channel.channel, request },
    localLog: fixture.log,
    writer: args.wrapWriter === undefined ? realWriter : args.wrapWriter(realWriter),
    threadId,
    onSyncFailed: (failure) => failures.push(failure),
  })

  const snapshots: Promise<number[]>[] = []
  const listen = () => {
    const notified = { count: 0 }
    const unsubscribe = log.subscribe(() => {
      notified.count += 1
      snapshots.push(log.readOwn({ threadId }).then((events) => events.map((event) => event.seq)))
    })
    return { notified, unsubscribe }
  }

  return { fixture, channel, remote, threadId, log, failures, snapshots, listen }
}

const appended = { type: 'events-appended' } as const

describe('MirroredEventLog completion notification', () => {
  it('publishes once, readable, when the writer lands after the channel parked', async () => {
    const writerEntered = gate()
    const writerMayFinish = gate()
    const { channel, remote, threadId, log, snapshots, listen } = await rig({
      localTexts: ['one'],
      wrapWriter: (real) => ({
        ...real,
        appendDelta: async (given) => {
          writerEntered.release()
          await writerMayFinish.released
          await real.appendDelta(given)
        },
      }),
    })
    const { notified } = listen()

    const before = await log.readOwn({ threadId })
    expect(before.map((event) => event.seq)).toEqual([1])

    remote.push(remoteEvent({ threadId, seq: 2, text: 'two' }))
    channel.receive({ kind: EServeFrame.Signal, seq: 2, signal: appended })
    await writerEntered.released
    channel.receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    expect(notified.count).toBe(0)

    writerMayFinish.release()
    await settled(() => notified.count === 1)
    await quiet()

    expect(notified.count).toBe(1)
    expect(await Promise.all(snapshots)).toEqual([[1, 2]])
  })

  it('stops publishing to a listener after it unsubscribes, and keeps publishing to the rest', async () => {
    const { channel, remote, threadId, log, listen } = await rig({ localTexts: ['one'] })
    const kept = listen()
    const dropped = listen()
    dropped.unsubscribe()

    remote.push(remoteEvent({ threadId, seq: 2, text: 'two' }))
    channel.receive({ kind: EServeFrame.Signal, seq: 2, signal: appended })
    await settled(async () => (await log.head({ threadId })) === 2)
    await quiet()

    expect(kept.notified.count).toBe(1)
    expect(dropped.notified.count).toBe(0)
  })

  it('stays silent for reads and for a sync that finds nothing new', async () => {
    const { fixture, channel, remote, threadId, log, listen } = await rig({ localTexts: ['one', 'two'] })
    remote.push(...(await fixture.log.readOwn({ threadId })))
    const { notified } = listen()

    await log.read({ threadId })
    await log.head({ threadId })
    channel.receive({ kind: EServeFrame.Signal, seq: 2, signal: appended })
    await log.converge()
    await quiet()

    expect(notified.count).toBe(0)
  })

  it('stays silent when the writer fails, and publishes once a later sync lands', async () => {
    let diskFull = true
    const { channel, remote, threadId, log, failures, listen } = await rig({
      localTexts: ['one'],
      wrapWriter: (real) => ({
        ...real,
        appendDelta: async (given) => {
          if (diskFull) throw new Error('disk full')
          await real.appendDelta(given)
        },
      }),
    })
    const { notified } = listen()
    remote.push(remoteEvent({ threadId, seq: 2, text: 'two' }))

    channel.receive({ kind: EServeFrame.Signal, seq: 2, signal: appended })
    await settled(() => failures.length === 1)
    await quiet()
    expect(notified.count).toBe(0)

    diskFull = false
    await log.read({ threadId })
    await settled(() => notified.count === 1)
  })

  it('publishes when a divergence rewrite changes identity without moving the head', async () => {
    const { remote, threadId, log, snapshots, listen, fixture } = await rig({ localTexts: ['one', 'two'] })
    remote.push(remoteEvent({ threadId, seq: 1, text: 'one' }), remoteEvent({ threadId, seq: 2, text: 'two' }))
    const { notified } = listen()

    await log.converge()
    await settled(() => notified.count === 1)
    await quiet()

    expect(notified.count).toBe(1)
    expect(await Promise.all(snapshots)).toEqual([[1, 2]])
    const landed = await fixture.log.readOwn({ threadId })
    expect(landed.map((event) => event.id)).toEqual([toEventId('remote-evt-1'), toEventId('remote-evt-2')])
  })
})
